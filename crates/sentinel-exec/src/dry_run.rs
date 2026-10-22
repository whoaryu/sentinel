use std::path::Path;
use std::time::SystemTime;
use chrono::{DateTime, Utc};
use glob::Pattern;
use sysinfo::{Pid, System};
use walkdir::WalkDir;

use crate::traits::PrivilegedExecutor;
use crate::types::{ActionResult, DryRunResult, ElevationToken, ExecError};
use sentinel_core::{Action, ProcessTarget};

pub struct DryRunExecutor;

impl DryRunExecutor {
    pub fn new() -> Self {
        Self
    }
}

impl Default for DryRunExecutor {
    fn default() -> Self {
        Self::new()
    }
}

impl PrivilegedExecutor for DryRunExecutor {
    fn execute_action(&self, action: &Action) -> Result<ActionResult, ExecError> {
        let dry = self.dry_run_action(action)?;
        Ok(ActionResult {
            success: true,
            message: format!("[DRY RUN SIMULATION] {}", dry.message),
            files_affected: dry.simulated_files_affected,
            bytes_freed: dry.simulated_bytes_freed,
            undo_action: None,
            details: dry.details,
        })
    }

    fn dry_run_action(&self, action: &Action) -> Result<DryRunResult, ExecError> {
        match action {
            Action::DeleteFile { path, reason } => {
                let exists = path.exists();
                let size = if exists {
                    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
                } else {
                    0
                };
                let status = if exists { "exists" } else { "does not exist currently" };
                Ok(DryRunResult {
                    message: format!(
                        "Would soft-delete '{}' ({}) and free ~{:.2} MB. Reason: {}",
                        path.display(),
                        status,
                        size as f64 / 1_048_576.0,
                        reason
                    ),
                    simulated_files_affected: if exists { 1 } else { 0 },
                    simulated_bytes_freed: size,
                    details: vec![format!("Path: {}, size: {} bytes, status: {}", path.display(), size, status)],
                })
            }

            Action::DeleteFilesMatching {
                root,
                older_than_days,
                pattern,
                reason,
            } => {
                let (count, bytes, matched_details) = scan_matching_files(root, pattern.as_deref(), *older_than_days);
                Ok(DryRunResult {
                    message: format!(
                        "Would soft-delete {} files in '{}' matching pattern '{:?}' (older than {:?} days), freeing ~{:.2} MB. Reason: {}",
                        count,
                        root.display(),
                        pattern,
                        older_than_days,
                        bytes as f64 / 1_048_576.0,
                        reason
                    ),
                    simulated_files_affected: count,
                    simulated_bytes_freed: bytes,
                    details: matched_details,
                })
            }

            Action::MoveFile { from, to, reason } => {
                let exists = from.exists();
                let size = if exists {
                    std::fs::metadata(from).map(|m| m.len()).unwrap_or(0)
                } else {
                    0
                };
                Ok(DryRunResult {
                    message: format!(
                        "Would move '{}' to '{}' (~{:.2} MB). Reason: {}",
                        from.display(),
                        to.display(),
                        size as f64 / 1_048_576.0,
                        reason
                    ),
                    simulated_files_affected: if exists { 1 } else { 0 },
                    simulated_bytes_freed: 0,
                    details: vec![format!("From: {}, To: {}, Size: {} bytes", from.display(), to.display(), size)],
                })
            }

            Action::MoveFilesMatching {
                root,
                destination,
                pattern,
                older_than_days,
                reason,
            } => {
                let (count, _, matched_details) = scan_matching_files(root, pattern.as_deref(), *older_than_days);
                Ok(DryRunResult {
                    message: format!(
                        "Would move {} files matching '{:?}' from '{}' to '{}'. Reason: {}",
                        count,
                        pattern,
                        root.display(),
                        destination.display(),
                        reason
                    ),
                    simulated_files_affected: count,
                    simulated_bytes_freed: 0,
                    details: matched_details,
                })
            }

            Action::ChangePermissions {
                path,
                mode,
                recursive,
                reason,
            } => {
                let exists = path.exists();
                Ok(DryRunResult {
                    message: format!(
                        "Would update permissions on '{}' to {:?} (recursive: {}). Reason: {}",
                        path.display(),
                        mode,
                        recursive,
                        reason
                    ),
                    simulated_files_affected: if exists { 1 } else { 0 },
                    simulated_bytes_freed: 0,
                    details: vec![format!("Target: {}, Exists: {}", path.display(), exists)],
                })
            }

            Action::KillProcess {
                pid_or_name,
                signal,
                reason,
            } => {
                let mut sys = System::new();
                sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

                let mut matched = Vec::new();
                match pid_or_name {
                    ProcessTarget::Pid(pid) => {
                        let sys_pid = Pid::from(*pid as usize);
                        if let Some(proc) = sys.process(sys_pid) {
                            matched.push(format!("PID {} ({})", pid, proc.name().to_string_lossy()));
                        }
                    }
                    ProcessTarget::Name(name) => {
                        let lower = name.to_lowercase();
                        for (pid, proc) in sys.processes() {
                            if proc.name().to_string_lossy().to_lowercase().contains(&lower) {
                                matched.push(format!("PID {} ({})", pid.as_u32(), proc.name().to_string_lossy()));
                            }
                        }
                    }
                }

                let count = matched.len() as u64;
                Ok(DryRunResult {
                    message: format!(
                        "Would send {:?} to {} matching process(es): {:?}. Reason: {}",
                        signal,
                        count,
                        pid_or_name,
                        reason
                    ),
                    simulated_files_affected: count,
                    simulated_bytes_freed: 0,
                    details: matched,
                })
            }

            Action::CompressDirectory {
                path,
                output,
                delete_source,
                reason,
            } => {
                let mut size = 0u64;
                let mut file_count = 0u64;
                if path.exists() {
                    for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
                        if entry.file_type().is_file() {
                            file_count += 1;
                            size += entry.metadata().map(|m| m.len()).unwrap_or(0);
                        }
                    }
                }
                Ok(DryRunResult {
                    message: format!(
                        "Would compress '{}' ({} files, {:.2} MB) into '{}' (delete source: {}). Reason: {}",
                        path.display(),
                        file_count,
                        size as f64 / 1_048_576.0,
                        output.display(),
                        delete_source,
                        reason
                    ),
                    simulated_files_affected: file_count,
                    simulated_bytes_freed: if *delete_source { size } else { 0 },
                    details: vec![format!("Source: {}, Output: {}, Size: {} bytes", path.display(), output.display(), size)],
                })
            }

            Action::FindLargeFiles { root, min_size_mb } => {
                let min_bytes = min_size_mb * 1024 * 1024;
                let mut count = 0u64;
                let mut total_size = 0u64;
                let mut details = Vec::new();

                if root.exists() {
                    for entry in WalkDir::new(root).max_depth(5).into_iter().filter_map(|e| e.ok()) {
                        if entry.file_type().is_file() {
                            if let Ok(meta) = entry.metadata() {
                                if meta.len() >= min_bytes {
                                    count += 1;
                                    total_size += meta.len();
                                    details.push(format!(
                                        "{} ({:.2} MB)",
                                        entry.path().display(),
                                        meta.len() as f64 / 1_048_576.0
                                    ));
                                    if details.len() >= 20 {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }

                Ok(DryRunResult {
                    message: format!(
                        "Found {} files >= {} MB in '{}' (total {:.2} MB)",
                        count,
                        min_size_mb,
                        root.display(),
                        total_size as f64 / 1_048_576.0
                    ),
                    simulated_files_affected: count,
                    simulated_bytes_freed: 0,
                    details,
                })
            }

            Action::EmptyTrash => {
                let trash_dir = get_trash_directory();
                let mut count = 0u64;
                let mut size = 0u64;
                if trash_dir.exists() {
                    for entry in WalkDir::new(&trash_dir).into_iter().filter_map(|e| e.ok()) {
                        if entry.file_type().is_file() {
                            count += 1;
                            size += entry.metadata().map(|m| m.len()).unwrap_or(0);
                        }
                    }
                }

                Ok(DryRunResult {
                    message: format!(
                        "Would purge {} files ({:.2} MB) from Sentinel trash directory '{}'",
                        count,
                        size as f64 / 1_048_576.0,
                        trash_dir.display()
                    ),
                    simulated_files_affected: count,
                    simulated_bytes_freed: size,
                    details: vec![format!("Trash dir: {}, Items: {}, Size: {} bytes", trash_dir.display(), count, size)],
                })
            }

            Action::ListRunningProcesses { filter } => {
                let mut sys = System::new();
                sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

                let filter_str = filter.as_deref().unwrap_or("").to_lowercase();
                let mut matched = Vec::new();
                for (pid, proc) in sys.processes() {
                    let name = proc.name().to_string_lossy();
                    if filter_str.is_empty() || name.to_lowercase().contains(&filter_str) {
                        matched.push(format!("PID {}: {} ({:.1} MB)", pid.as_u32(), name, proc.memory() as f64 / 1_048_576.0));
                        if matched.len() >= 50 {
                            break;
                        }
                    }
                }

                let count = matched.len() as u64;
                Ok(DryRunResult {
                    message: format!("Found {} running process(es) matching filter '{:?}'", count, filter),
                    simulated_files_affected: count,
                    simulated_bytes_freed: 0,
                    details: matched,
                })
            }
        }
    }

    fn elevate(&self) -> Result<ElevationToken, ExecError> {
        Ok(ElevationToken {
            token: "dry-run-simulation-token".to_string(),
            elevated: false,
            mechanism: "dry_run".to_string(),
        })
    }
}

pub fn get_trash_directory() -> std::path::PathBuf {
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        std::path::PathBuf::from(home).join(".sentinel-trash")
    } else {
        std::env::temp_dir().join(".sentinel-trash")
    }
}

pub fn scan_matching_files(
    root: &Path,
    pattern: Option<&str>,
    older_than_days: Option<u32>,
) -> (u64, u64, Vec<String>) {
    let mut count = 0u64;
    let mut bytes = 0u64;
    let mut matched = Vec::new();

    if !root.exists() {
        return (0, 0, matched);
    }

    let glob_pat = pattern.and_then(|p| Pattern::new(p).ok());
    let now = SystemTime::now();

    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy();
        if let Some(ref pat) = glob_pat {
            if !pat.matches(&file_name) {
                continue;
            }
        }

        if let Some(days) = older_than_days {
            if let Ok(meta) = entry.metadata() {
                if let Ok(modified) = meta.modified() {
                    if let Ok(duration) = now.duration_since(modified) {
                        let age_days = duration.as_secs() / 86400;
                        if age_days < days as u64 {
                            continue;
                        }
                    }
                }
            }
        }

        let file_size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        count += 1;
        bytes += file_size;
        if matched.len() < 30 {
            matched.push(format!("{} ({} bytes)", entry.path().display(), file_size));
        }
    }

    (count, bytes, matched)
}
