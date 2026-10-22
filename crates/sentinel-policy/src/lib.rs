use std::path::{Component, Path, PathBuf};
use sentinel_core::{
    Action, ActionPlan, EvaluatedAction, EvaluatedPlan, KillSignal,
    PolicyDecision, ProcessTarget,
};

#[derive(Debug, Clone)]
pub struct PolicyConfig {
    pub allowed_roots: Vec<PathBuf>,
    pub max_safe_file_count: u64,
    pub max_safe_size_mb: f64,
    pub min_path_components: usize,
    pub min_safe_pid: u32,
    pub protected_processes: Vec<String>,
}

impl Default for PolicyConfig {
    fn default() -> Self {
        let mut allowed_roots = Vec::new();
        // Add HOME or USERPROFILE
        if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
            allowed_roots.push(PathBuf::from(home));
        }

        Self {
            allowed_roots,
            max_safe_file_count: 50,
            max_safe_size_mb: 500.0,
            min_path_components: 3,
            min_safe_pid: 100,
            protected_processes: vec![
                "system".to_string(),
                "system idle process".to_string(),
                "csrss.exe".to_string(),
                "csrss".to_string(),
                "lsass.exe".to_string(),
                "lsass".to_string(),
                "services.exe".to_string(),
                "services".to_string(),
                "smss.exe".to_string(),
                "smss".to_string(),
                "wininit.exe".to_string(),
                "wininit".to_string(),
                "svchost.exe".to_string(),
                "svchost".to_string(),
                "init".to_string(),
                "systemd".to_string(),
                "launchd".to_string(),
                "kernel".to_string(),
            ],
        }
    }
}

pub struct PolicyEngine {
    config: PolicyConfig,
}

impl Default for PolicyEngine {
    fn default() -> Self {
        Self::new(PolicyConfig::default())
    }
}

impl PolicyEngine {
    pub fn new(config: PolicyConfig) -> Self {
        Self { config }
    }

    pub fn with_allowed_root(mut self, root: PathBuf) -> Self {
        self.config.allowed_roots.push(root);
        self
    }

    /// Evaluates a single action synchronously without any I/O.
    pub fn evaluate(&self, action: &Action) -> PolicyDecision {
        match action {
            Action::DeleteFile { path, .. } => {
                if let Err(denial) = self.check_path_safety(path, true) {
                    return PolicyDecision::Deny(denial);
                }
                PolicyDecision::Allow
            }

            Action::DeleteFilesMatching { root, older_than_days, .. } => {
                if let Err(denial) = self.check_path_safety(root, false) {
                    return PolicyDecision::Deny(denial);
                }
                if older_than_days.is_none() {
                    return PolicyDecision::RequireExtraConfirmation(
                        "DeleteFilesMatching has no age filter; this will delete all matching files regardless of age.".to_string(),
                    );
                }
                PolicyDecision::Allow
            }

            Action::MoveFile { from, to, .. } => {
                if let Err(denial) = self.check_path_safety(from, false) {
                    return PolicyDecision::Deny(format!("Source path denied: {}", denial));
                }
                if let Err(denial) = self.check_path_safety(to, false) {
                    return PolicyDecision::Deny(format!("Destination path denied: {}", denial));
                }
                PolicyDecision::Allow
            }

            Action::MoveFilesMatching { root, destination, .. } => {
                if let Err(denial) = self.check_path_safety(root, false) {
                    return PolicyDecision::Deny(format!("Source root denied: {}", denial));
                }
                if let Err(denial) = self.check_path_safety(destination, false) {
                    return PolicyDecision::Deny(format!("Destination root denied: {}", denial));
                }
                PolicyDecision::Allow
            }

            Action::ChangePermissions { path, .. } => {
                if let Err(denial) = self.check_path_safety(path, false) {
                    return PolicyDecision::Deny(denial);
                }
                PolicyDecision::Allow
            }

            Action::KillProcess { pid_or_name, signal, .. } => {
                match pid_or_name {
                    ProcessTarget::Pid(pid) => {
                        if *pid < self.config.min_safe_pid {
                            return PolicyDecision::Deny(format!(
                                "PID {} is a protected system process (PID < {})",
                                pid, self.config.min_safe_pid
                            ));
                        }
                    }
                    ProcessTarget::Name(name) => {
                        let lower = name.to_lowercase();
                        if self.config.protected_processes.iter().any(|p| p.to_lowercase() == lower) {
                            return PolicyDecision::Deny(format!(
                                "Process '{}' is in the protected system processes list",
                                name
                            ));
                        }
                    }
                }

                if *signal == KillSignal::Kill {
                    PolicyDecision::RequireExtraConfirmation(
                        "SIGKILL forcefully aborts execution without clean shutdown.".to_string(),
                    )
                } else {
                    PolicyDecision::Allow
                }
            }

            Action::CompressDirectory { path, output, delete_source, .. } => {
                if let Err(denial) = self.check_path_safety(path, false) {
                    return PolicyDecision::Deny(format!("Source directory denied: {}", denial));
                }
                if let Err(denial) = self.check_path_safety(output, false) {
                    return PolicyDecision::Deny(format!("Output path denied: {}", denial));
                }
                if *delete_source {
                    return PolicyDecision::RequireExtraConfirmation(
                        "CompressDirectory has delete_source set to true; source files will be deleted after compression.".to_string(),
                    );
                }
                PolicyDecision::Allow
            }

            Action::FindLargeFiles { root, .. } => {
                if let Err(denial) = self.check_path_safety(root, false) {
                    return PolicyDecision::Deny(denial);
                }
                PolicyDecision::Allow
            }

            Action::EmptyTrash => {
                PolicyDecision::RequireExtraConfirmation(
                    "Emptying trash permanently purges all soft-deleted files.".to_string(),
                )
            }

            Action::ListRunningProcesses { .. } => PolicyDecision::Allow,
        }
    }

    /// Evaluates an entire ActionPlan, enforcing blast-radius caps and combining decisions.
    pub fn evaluate_plan(&self, plan: &ActionPlan) -> EvaluatedPlan {
        let mut evaluated_actions = Vec::with_capacity(plan.actions.len());
        let mut overall_decision = PolicyDecision::Allow;

        for action in &plan.actions {
            let decision = self.evaluate(action);
            let risk = action.default_risk_level();
            let reversible = action.is_inherently_reversible();

            if decision.is_denied() && !overall_decision.is_denied() {
                overall_decision = decision.clone();
            } else if decision.is_confirmation_required() && overall_decision.is_allowed() {
                overall_decision = decision.clone();
            }

            evaluated_actions.push(EvaluatedAction {
                action: action.clone(),
                decision,
                risk_level: risk,
                reversible,
            });
        }

        // Blast-radius check
        if let Some(count) = plan.estimated_impact.file_count {
            if count > self.config.max_safe_file_count && overall_decision.is_allowed() {
                overall_decision = PolicyDecision::RequireExtraConfirmation(format!(
                    "Blast-radius cap exceeded: Plan estimates affecting {} files (limit: {})",
                    count, self.config.max_safe_file_count
                ));
            }
        }

        if let Some(size) = plan.estimated_impact.total_size_mb {
            if size > self.config.max_safe_size_mb && overall_decision.is_allowed() {
                overall_decision = PolicyDecision::RequireExtraConfirmation(format!(
                    "Blast-radius cap exceeded: Plan estimates modifying {:.1} MB (limit: {:.1} MB)",
                    size, self.config.max_safe_size_mb
                ));
            }
        }

        EvaluatedPlan {
            plan: plan.clone(),
            evaluated_actions,
            overall_decision,
        }
    }

    /// Check path safety according to rules:
    /// 1. Deny path traversal (..)
    /// 2. Deny path outside allowed roots (if allowed_roots is configured)
    /// 3. Deny deleting paths with fewer than min_path_components
    fn check_path_safety(&self, path: &Path, is_deletion: bool) -> Result<(), String> {
        let path_str = path.to_string_lossy();

        // Rule 1: Deny path traversal
        if path_str.contains("..") {
            return Err(format!("Path contains traversal sequence '..': {}", path.display()));
        }

        for comp in path.components() {
            if matches!(comp, Component::ParentDir) {
                return Err(format!("Path traversal detected via ParentDir: {}", path.display()));
            }
        }

        // Rule 2: Deny outside allowed roots if allowed roots are specified
        if !self.config.allowed_roots.is_empty() {
            let normalized_path = normalize_path(path);
            let is_inside_allowed = self.config.allowed_roots.iter().any(|root| {
                let norm_root = normalize_path(root);
                normalized_path.starts_with(&norm_root)
            });

            if !is_inside_allowed {
                let roots_str = self
                    .config
                    .allowed_roots
                    .iter()
                    .map(|r| r.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                return Err(format!(
                    "Path '{}' is outside the allowed root directory(s): [{}]",
                    path.display(),
                    roots_str
                ));
            }
        }

        // Rule 3: Deny deleting with fewer than N path components
        if is_deletion {
            let normal_components: Vec<_> = path
                .components()
                .filter(|c| matches!(c, Component::Normal(_)))
                .collect();

            if normal_components.len() < self.config.min_path_components {
                return Err(format!(
                    "Cannot delete shallow system path '{}' (has only {} normal components, minimum required is {})",
                    path.display(),
                    normal_components.len(),
                    self.config.min_path_components
                ));
            }
        }

        Ok(())
    }
}

fn normalize_path(p: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in p.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(std::path::MAIN_SEPARATOR.to_string()),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(c) => normalized.push(c),
        }
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use sentinel_core::{ImpactSummary, KillSignal, PermissionSpec, ProcessTarget};
    use uuid::Uuid;

    fn test_engine() -> PolicyEngine {
        let config = PolicyConfig {
            allowed_roots: vec![PathBuf::from("/home/alice"), PathBuf::from("C:\\Users\\alice")],
            max_safe_file_count: 50,
            max_safe_size_mb: 500.0,
            min_path_components: 3,
            min_safe_pid: 100,
            protected_processes: vec!["csrss.exe".into(), "system".into(), "init".into()],
        };
        PolicyEngine::new(config)
    }

    #[test]
    fn test_1_allow_normal_downloads_cleanup() {
        let engine = test_engine();
        let action = Action::DeleteFilesMatching {
            root: PathBuf::from("/home/alice/Downloads"),
            older_than_days: Some(30),
            pattern: Some("*.tmp".into()),
            reason: "Cleaning old temporary files".into(),
        };
        assert_eq!(engine.evaluate(&action), PolicyDecision::Allow);
    }

    #[test]
    fn test_2_deny_path_traversal_dot_dot_slash() {
        let engine = test_engine();
        let action = Action::DeleteFile {
            path: PathBuf::from("/home/alice/../../../etc/passwd"),
            reason: "Malicious traversal".into(),
        };
        match engine.evaluate(&action) {
            PolicyDecision::Deny(msg) => assert!(msg.contains("traversal")),
            other => panic!("Expected Deny, got {:?}", other),
        }
    }

    #[test]
    fn test_3_deny_outside_allowed_root_etc_passwd() {
        let engine = test_engine();
        let action = Action::DeleteFile {
            path: PathBuf::from("/etc/passwd"),
            reason: "Try deleting system file".into(),
        };
        match engine.evaluate(&action) {
            PolicyDecision::Deny(msg) => assert!(msg.contains("outside the allowed root")),
            other => panic!("Expected Deny, got {:?}", other),
        }
    }

    #[test]
    fn test_4_deny_windows_system32() {
        let engine = test_engine();
        let action = Action::DeleteFile {
            path: PathBuf::from("C:\\Windows\\System32\\drivers.sys"),
            reason: "Try deleting Windows system file".into(),
        };
        match engine.evaluate(&action) {
            PolicyDecision::Deny(msg) => assert!(msg.contains("outside the allowed root")),
            other => panic!("Expected Deny, got {:?}", other),
        }
    }

    #[test]
    fn test_5_deny_shallow_deletion_home_alice() {
        let engine = test_engine();
        // Path has only 2 normal components: "home" and "alice"
        let action = Action::DeleteFile {
            path: PathBuf::from("/home/alice"),
            reason: "Try deleting user directory directly".into(),
        };
        match engine.evaluate(&action) {
            PolicyDecision::Deny(msg) => assert!(msg.contains("shallow system path")),
            other => panic!("Expected Deny, got {:?}", other),
        }
    }

    #[test]
    fn test_6_allow_deep_file_deletion() {
        let engine = test_engine();
        let action = Action::DeleteFile {
            path: PathBuf::from("/home/alice/Downloads/old_report.pdf"),
            reason: "Delete unneeded file".into(),
        };
        assert_eq!(engine.evaluate(&action), PolicyDecision::Allow);
    }

    #[test]
    fn test_7_require_confirmation_when_no_age_filter() {
        let engine = test_engine();
        let action = Action::DeleteFilesMatching {
            root: PathBuf::from("/home/alice/Downloads"),
            older_than_days: None,
            pattern: Some("*".into()),
            reason: "Delete all files in downloads".into(),
        };
        match engine.evaluate(&action) {
            PolicyDecision::RequireExtraConfirmation(msg) => {
                assert!(msg.contains("no age filter"))
            }
            other => panic!("Expected RequireExtraConfirmation, got {:?}", other),
        }
    }

    #[test]
    fn test_8_deny_kill_process_pid_under_100() {
        let engine = test_engine();
        let action = Action::KillProcess {
            pid_or_name: ProcessTarget::Pid(4),
            signal: KillSignal::Terminate,
            reason: "Kill system pid 4".into(),
        };
        match engine.evaluate(&action) {
            PolicyDecision::Deny(msg) => assert!(msg.contains("protected system process")),
            other => panic!("Expected Deny, got {:?}", other),
        }
    }

    #[test]
    fn test_9_deny_kill_process_by_protected_name() {
        let engine = test_engine();
        let action = Action::KillProcess {
            pid_or_name: ProcessTarget::Name("csrss.exe".into()),
            signal: KillSignal::Terminate,
            reason: "Kill csrss".into(),
        };
        match engine.evaluate(&action) {
            PolicyDecision::Deny(msg) => assert!(msg.contains("protected system processes")),
            other => panic!("Expected Deny, got {:?}", other),
        }
    }

    #[test]
    fn test_10_allow_kill_user_process() {
        let engine = test_engine();
        let action = Action::KillProcess {
            pid_or_name: ProcessTarget::Pid(5432),
            signal: KillSignal::Terminate,
            reason: "Kill runaway node process".into(),
        };
        assert_eq!(engine.evaluate(&action), PolicyDecision::Allow);
    }

    #[test]
    fn test_11_require_confirmation_for_sigkill() {
        let engine = test_engine();
        let action = Action::KillProcess {
            pid_or_name: ProcessTarget::Pid(5432),
            signal: KillSignal::Kill,
            reason: "Force kill node".into(),
        };
        match engine.evaluate(&action) {
            PolicyDecision::RequireExtraConfirmation(msg) => assert!(msg.contains("SIGKILL")),
            other => panic!("Expected RequireExtraConfirmation, got {:?}", other),
        }
    }

    #[test]
    fn test_12_require_confirmation_compress_delete_source() {
        let engine = test_engine();
        let action = Action::CompressDirectory {
            path: PathBuf::from("/home/alice/Projects/legacy"),
            output: PathBuf::from("/home/alice/Projects/legacy.zip"),
            delete_source: true,
            reason: "Archive and remove source".into(),
        };
        match engine.evaluate(&action) {
            PolicyDecision::RequireExtraConfirmation(msg) => assert!(msg.contains("delete_source")),
            other => panic!("Expected RequireExtraConfirmation, got {:?}", other),
        }
    }

    #[test]
    fn test_13_allow_compress_keep_source() {
        let engine = test_engine();
        let action = Action::CompressDirectory {
            path: PathBuf::from("/home/alice/Projects/legacy"),
            output: PathBuf::from("/home/alice/Projects/legacy.zip"),
            delete_source: false,
            reason: "Archive source".into(),
        };
        assert_eq!(engine.evaluate(&action), PolicyDecision::Allow);
    }

    #[test]
    fn test_14_allow_move_files() {
        let engine = test_engine();
        let action = Action::MoveFile {
            from: PathBuf::from("/home/alice/Downloads/tax.pdf"),
            to: PathBuf::from("/home/alice/Documents/tax.pdf"),
            reason: "File organization".into(),
        };
        assert_eq!(engine.evaluate(&action), PolicyDecision::Allow);
    }

    #[test]
    fn test_15_deny_move_to_system_directory() {
        let engine = test_engine();
        let action = Action::MoveFile {
            from: PathBuf::from("/home/alice/Downloads/bad.so"),
            to: PathBuf::from("/usr/lib/bad.so"),
            reason: "Drop payload to system".into(),
        };
        match engine.evaluate(&action) {
            PolicyDecision::Deny(msg) => assert!(msg.contains("Destination path denied")),
            other => panic!("Expected Deny, got {:?}", other),
        }
    }

    #[test]
    fn test_16_blast_radius_cap_files_over_50() {
        let engine = test_engine();
        let plan = ActionPlan {
            id: Uuid::new_v4(),
            original_request: "Delete 55 log files".into(),
            actions: vec![Action::DeleteFilesMatching {
                root: PathBuf::from("/home/alice/Downloads/logs"),
                older_than_days: Some(7),
                pattern: Some("*.log".into()),
                reason: "Clean logs".into(),
            }],
            estimated_impact: ImpactSummary {
                file_count: Some(51),
                total_size_mb: Some(40.0),
                reversible: false,
                notes: "51 files from 2024".into(),
            },
            created_at: Utc::now(),
        };

        let eval = engine.evaluate_plan(&plan);
        match eval.overall_decision {
            PolicyDecision::RequireExtraConfirmation(msg) => {
                assert!(msg.contains("Blast-radius cap exceeded"))
            }
            other => panic!("Expected RequireExtraConfirmation, got {:?}", other),
        }
    }

    #[test]
    fn test_17_blast_radius_cap_size_over_500mb() {
        let engine = test_engine();
        let plan = ActionPlan {
            id: Uuid::new_v4(),
            original_request: "Delete huge dumps".into(),
            actions: vec![Action::DeleteFilesMatching {
                root: PathBuf::from("/home/alice/Downloads/dumps"),
                older_than_days: Some(7),
                pattern: Some("*.dump".into()),
                reason: "Clean dumps".into(),
            }],
            estimated_impact: ImpactSummary {
                file_count: Some(3),
                total_size_mb: Some(550.0),
                reversible: false,
                notes: "Large memory dumps".into(),
            },
            created_at: Utc::now(),
        };

        let eval = engine.evaluate_plan(&plan);
        match eval.overall_decision {
            PolicyDecision::RequireExtraConfirmation(msg) => {
                assert!(msg.contains("Blast-radius cap exceeded"))
            }
            other => panic!("Expected RequireExtraConfirmation, got {:?}", other),
        }
    }

    #[test]
    fn test_18_require_confirmation_empty_trash() {
        let engine = test_engine();
        let action = Action::EmptyTrash;
        assert!(matches!(
            engine.evaluate(&action),
            PolicyDecision::RequireExtraConfirmation(_)
        ));
    }

    #[test]
    fn test_19_allow_find_large_files() {
        let engine = test_engine();
        let action = Action::FindLargeFiles {
            root: PathBuf::from("/home/alice/Documents"),
            min_size_mb: 100,
        };
        assert_eq!(engine.evaluate(&action), PolicyDecision::Allow);
    }

    #[test]
    fn test_20_allow_list_running_processes() {
        let engine = test_engine();
        let action = Action::ListRunningProcesses {
            filter: Some("chrome".into()),
        };
        assert_eq!(engine.evaluate(&action), PolicyDecision::Allow);
    }

    #[test]
    fn test_21_plan_with_one_denied_action_marks_overall_plan_denied() {
        let engine = test_engine();
        let plan = ActionPlan {
            id: Uuid::new_v4(),
            original_request: "Clean downloads and system".into(),
            actions: vec![
                Action::DeleteFile {
                    path: PathBuf::from("/home/alice/Downloads/sample.txt"),
                    reason: "Clean sample".into(),
                },
                Action::DeleteFile {
                    path: PathBuf::from("/etc/shadow"),
                    reason: "Delete shadow".into(),
                },
            ],
            estimated_impact: ImpactSummary {
                file_count: Some(2),
                total_size_mb: Some(1.0),
                reversible: false,
                notes: "Mixed plan".into(),
            },
            created_at: Utc::now(),
        };

        let eval = engine.evaluate_plan(&plan);
        assert!(eval.overall_decision.is_denied());
        assert_eq!(eval.evaluated_actions[0].decision, PolicyDecision::Allow);
        assert!(eval.evaluated_actions[1].decision.is_denied());
    }

    #[test]
    fn test_22_allow_change_permissions() {
        let engine = test_engine();
        let action = Action::ChangePermissions {
            path: PathBuf::from("/home/alice/bin/script.sh"),
            mode: PermissionSpec::Octal(0o755),
            recursive: false,
            reason: "Make executable".into(),
        };
        assert_eq!(engine.evaluate(&action), PolicyDecision::Allow);
    }
}
