use std::path::PathBuf;
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serde(untagged)]
pub enum PermissionSpec {
    Octal(u32),
    Text(String),
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serde(untagged)]
pub enum ProcessTarget {
    Pid(u32),
    Name(String),
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, JsonSchema)]
pub enum KillSignal {
    Terminate,
    Kill,
    Interrupt,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(tag = "type")]
pub enum Action {
    DeleteFile {
        path: PathBuf,
        reason: String,
    },
    DeleteFilesMatching {
        root: PathBuf,
        older_than_days: Option<u32>,
        pattern: Option<String>,
        reason: String,
    },
    MoveFile {
        from: PathBuf,
        to: PathBuf,
        reason: String,
    },
    MoveFilesMatching {
        root: PathBuf,
        destination: PathBuf,
        pattern: Option<String>,
        older_than_days: Option<u32>,
        reason: String,
    },
    ChangePermissions {
        path: PathBuf,
        mode: PermissionSpec,
        recursive: bool,
        reason: String,
    },
    KillProcess {
        pid_or_name: ProcessTarget,
        signal: KillSignal,
        reason: String,
    },
    CompressDirectory {
        path: PathBuf,
        output: PathBuf,
        delete_source: bool,
        reason: String,
    },
    FindLargeFiles {
        root: PathBuf,
        min_size_mb: u64,
    },
    EmptyTrash,
    ListRunningProcesses {
        filter: Option<String>,
    },
    // Deliberately NOT here: RunShellCommand(String)
}

impl Action {
    pub fn action_type_name(&self) -> &'static str {
        match self {
            Action::DeleteFile { .. } => "DeleteFile",
            Action::DeleteFilesMatching { .. } => "DeleteFilesMatching",
            Action::MoveFile { .. } => "MoveFile",
            Action::MoveFilesMatching { .. } => "MoveFilesMatching",
            Action::ChangePermissions { .. } => "ChangePermissions",
            Action::KillProcess { .. } => "KillProcess",
            Action::CompressDirectory { .. } => "CompressDirectory",
            Action::FindLargeFiles { .. } => "FindLargeFiles",
            Action::EmptyTrash => "EmptyTrash",
            Action::ListRunningProcesses { .. } => "ListRunningProcesses",
        }
    }

    pub fn reason(&self) -> Option<&str> {
        match self {
            Action::DeleteFile { reason, .. } => Some(reason),
            Action::DeleteFilesMatching { reason, .. } => Some(reason),
            Action::MoveFile { reason, .. } => Some(reason),
            Action::MoveFilesMatching { reason, .. } => Some(reason),
            Action::ChangePermissions { reason, .. } => Some(reason),
            Action::KillProcess { reason, .. } => Some(reason),
            Action::CompressDirectory { reason, .. } => Some(reason),
            Action::FindLargeFiles { .. } => None,
            Action::EmptyTrash => None,
            Action::ListRunningProcesses { .. } => None,
        }
    }

    pub fn target_summary(&self) -> String {
        match self {
            Action::DeleteFile { path, .. } => path.display().to_string(),
            Action::DeleteFilesMatching { root, pattern, older_than_days, .. } => {
                let pat = pattern.as_deref().unwrap_or("*");
                let age = older_than_days.map(|d| format!(", >{}d", d)).unwrap_or_default();
                format!("{}/{} ({})", root.display(), pat, age)
            }
            Action::MoveFile { from, to, .. } => {
                format!("{} → {}", from.display(), to.display())
            }
            Action::MoveFilesMatching { root, destination, pattern, .. } => {
                let pat = pattern.as_deref().unwrap_or("*");
                format!("{}/{} → {}", root.display(), pat, destination.display())
            }
            Action::ChangePermissions { path, recursive, .. } => {
                format!("{} (recursive: {})", path.display(), recursive)
            }
            Action::KillProcess { pid_or_name, signal, .. } => match pid_or_name {
                ProcessTarget::Pid(pid) => format!("PID {} ({:?})", pid, signal),
                ProcessTarget::Name(name) => format!("Process '{}' ({:?})", name, signal),
            },
            Action::CompressDirectory { path, output, delete_source, .. } => {
                format!("{} → {} (delete source: {})", path.display(), output.display(), delete_source)
            }
            Action::FindLargeFiles { root, min_size_mb } => {
                format!("{} (>= {} MB)", root.display(), min_size_mb)
            }
            Action::EmptyTrash => "Sentinel Trash Directory".to_string(),
            Action::ListRunningProcesses { filter } => {
                format!("Processes (filter: {})", filter.as_deref().unwrap_or("none"))
            }
        }
    }

    pub fn is_inherently_reversible(&self) -> bool {
        match self {
            Action::MoveFile { .. } | Action::MoveFilesMatching { .. } => true,
            Action::CompressDirectory { delete_source, .. } => !delete_source,
            Action::FindLargeFiles { .. } | Action::ListRunningProcesses { .. } => true,
            Action::DeleteFile { .. } => false, // soft-deleted via trash gives safety, but operation itself is destructive
            Action::DeleteFilesMatching { .. } => false,
            Action::ChangePermissions { .. } => true, // can be reverted if previous permission known
            Action::KillProcess { .. } => false,
            Action::EmptyTrash => false,
        }
    }

    pub fn default_risk_level(&self) -> RiskLevel {
        match self {
            Action::FindLargeFiles { .. } | Action::ListRunningProcesses { .. } => RiskLevel::Low,
            Action::MoveFile { .. } | Action::MoveFilesMatching { .. } => RiskLevel::Low,
            Action::ChangePermissions { .. } => RiskLevel::Low,
            Action::CompressDirectory { delete_source, .. } => {
                if *delete_source {
                    RiskLevel::High
                } else {
                    RiskLevel::Low
                }
            }
            Action::DeleteFilesMatching { older_than_days, .. } => {
                if older_than_days.is_none() {
                    RiskLevel::Critical
                } else {
                    RiskLevel::Medium
                }
            }
            Action::DeleteFile { .. } => RiskLevel::Medium,
            Action::KillProcess { .. } => RiskLevel::High,
            Action::EmptyTrash => RiskLevel::High,
        }
    }
}

fn default_notes() -> String {
    "Estimated by planner".to_string()
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct ImpactSummary {
    #[serde(default)]
    pub file_count: Option<u64>,
    #[serde(default)]
    pub total_size_mb: Option<f64>,
    #[serde(default)]
    pub reversible: bool,
    #[serde(default = "default_notes")]
    pub notes: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct ActionPlan {
    #[serde(default = "uuid::Uuid::new_v4")]
    pub id: Uuid,
    #[serde(default)]
    pub original_request: String,
    pub actions: Vec<Action>,
    pub estimated_impact: ImpactSummary,
    #[serde(default = "chrono::Utc::now")]
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(tag = "type")]
pub enum LlmResponse {
    Plan(ActionPlan),
    NeedsClarification { question: String },
    CannotDo { reason: String },
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, JsonSchema)]
#[serde(tag = "status", content = "reason")]
pub enum PolicyDecision {
    Allow,
    Deny(String),
    RequireExtraConfirmation(String),
}

impl PolicyDecision {
    pub fn is_allowed(&self) -> bool {
        matches!(self, PolicyDecision::Allow)
    }

    pub fn is_denied(&self) -> bool {
        matches!(self, PolicyDecision::Deny(_))
    }

    pub fn is_confirmation_required(&self) -> bool {
        matches!(self, PolicyDecision::RequireExtraConfirmation(_))
    }

    pub fn reason(&self) -> Option<&str> {
        match self {
            PolicyDecision::Allow => None,
            PolicyDecision::Deny(r) => Some(r),
            PolicyDecision::RequireExtraConfirmation(r) => Some(r),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, JsonSchema)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct EvaluatedAction {
    pub action: Action,
    pub decision: PolicyDecision,
    pub risk_level: RiskLevel,
    pub reversible: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct EvaluatedPlan {
    pub plan: ActionPlan,
    pub evaluated_actions: Vec<EvaluatedAction>,
    pub overall_decision: PolicyDecision,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, JsonSchema)]
pub enum PlanStatus {
    Drafting,
    PendingApproval,
    Approved,
    Executing,
    Completed,
    Failed,
    Rejected,
}

impl PlanStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            PlanStatus::Drafting => "Drafting",
            PlanStatus::PendingApproval => "PendingApproval",
            PlanStatus::Approved => "Approved",
            PlanStatus::Executing => "Executing",
            PlanStatus::Completed => "Completed",
            PlanStatus::Failed => "Failed",
            PlanStatus::Rejected => "Rejected",
        }
    }
}
