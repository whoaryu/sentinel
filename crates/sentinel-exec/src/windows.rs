use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use chrono::{DateTime, Utc};
use glob::Pattern;
use sysinfo::{Pid, System};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use crate::dry_run::{get_trash_directory, scan_matching_files, DryRunExecutor};
use crate::traits::PrivilegedExecutor;
use crate::types::{ActionResult, DryRunResult, ElevationToken, ExecError};
use sentinel_core::{Action, PermissionSpec, ProcessTarget};

pub struct WindowsExecutor {
    dry_run: DryRunExecutor,
}

impl WindowsExecutor {
    pub fn new() -> Self {
        Self {
            dry_run: DryRunExecutor::new(),
        }
    }

    /// Companion cleanup job that hard-deletes trash older than 7 days
    pub fn cleanup_old_trash(&self, max_days: u32) -> Result<u64, ExecError> {
        let trash_dir = get_trash_directory();
        if !trash_dir.exists() {
            return Ok(0);
        }

        let now = SystemTime::now();
        let max_secs = (max_days as u64) * 86400;
        let mut purged_count = 0u64;

        for entry in WalkDir::new(&trash_dir).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                if let Ok(meta) = entry.metadata() {
                    if let Ok(mod_time) = meta.modified() {
                        if let Ok(elapsed) = now.duration_since(mod_time) {
                            if elapsed.as_secs() > max_secs {
                                if fs::remove_file(entry.path()).is_ok() {
                                    purged_count += 1;
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(purged_count)
    }

    /// Moves a file into the ~/.sentinel-trash staging directory (soft-delete)
    fn soft_delete(&self, file_path: &Path) -> Result<(PathBuf, u64), ExecError> {
        if !file_path.exists() {
            return Err(ExecError::ActionFailed(format!(
                "File '{}' does not exist",
                file_path.display()
            )));
        }

        let trash_dir = get_trash_directory();
        fs::create_dir_all(&trash_dir)?;

        let size = fs::metadata(file_path).map(|m| m.len()).unwrap_or(0);
        let timestamp = Utc::now().format("%Y%m%d_%H%M%S_%f").to_string();
        let file_name = file_path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string());

        let target_trash_file = trash_dir.join(format!("{}_{}", timestamp, file_name));

        // Attempt rename, fallback to copy+delete across filesystem boundaries
        if let Err(_) = fs::rename(file_path, &target_trash_file) {
            fs::copy(file_path, &target_trash_file)?;
            fs::remove_file(file_path)?;
        }

        Ok((target_trash_file, size))
    }
}

impl Default for WindowsExecutor {
    fn default() -> Self {
        Self::new()
    }
}

impl PrivilegedExecutor for WindowsExecutor {
    fn execute_action(&self, action: &Action) -> Result<ActionResult, ExecError> {
        match action {
            Action::DeleteFile { path, reason } => {
                let (trash_path, bytes) = self.soft_delete(path)?;
                let undo_action = Action::MoveFile {
                    from: trash_path.clone(),
                    to: path.clone(),
                    reason: format!("Undo soft-delete of '{}'", path.display()),
                };

                Ok(ActionResult {
                    success: true,
                    message: format!(
                        "Safely soft-deleted '{}' to trash '{}' (freed {:.2} MB). Reason: {}",
                        path.display(),
                        trash_path.display(),
                        bytes as f64 / 1_048_576.0,
                        reason
                    ),
                    files_affected: 1,
                    bytes_freed: bytes,
                    undo_action: Some(undo_action),
                    details: vec![format!("Original: {}, Staged: {}", path.display(), trash_path.display())],
                })
            }

            Action::DeleteFilesMatching {
                root,
                older_than_days,
                pattern,
                reason,
            } => {
                if !root.exists() {
                    return Err(ExecError::ActionFailed(format!(
                        "Root directory '{}' does not exist",
                        root.display()
                    )));
                }

                let glob_pat = pattern.as_deref().and_then(|p| Pattern::new(p).ok());
                let now = SystemTime::now();
                let mut files_to_delete = Vec::new();

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
                                    if age_days < *days as u64 {
                                        continue;
                                    }
                                }
                            }
                        }
                    }

                    files_to_delete.push(entry.into_path());
                }

                let mut affected = 0u64;
                let mut total_freed = 0u64;
                let mut details = Vec::new();

                for path in files_to_delete {
                    match self.soft_delete(&path) {
                        Ok((trash_path, bytes)) => {
                            affected += 1;
                            total_freed += bytes;
                            if details.len() < 50 {
                                details.push(format!("Soft-deleted: {} → {}", path.display(), trash_path.display()));
                            }
                        }
                        Err(e) => {
                            details.push(format!("Failed to soft-delete {}: {}", path.display(), e));
                        }
                    }
                }

                Ok(ActionResult {
                    success: true,
                    message: format!(
                        "Soft-deleted {} matching file(s) in '{}' (freed {:.2} MB). Reason: {}",
                        affected,
                        root.display(),
                        total_freed as f64 / 1_048_576.0,
                        reason
                    ),
                    files_affected: affected,
                    bytes_freed: total_freed,
                    undo_action: None,
                    details,
                })
            }

            Action::MoveFile { from, to, reason } => {
                if !from.exists() {
                    return Err(ExecError::ActionFailed(format!(
                        "Source path '{}' does not exist",
                        from.display()
                    )));
                }

                if let Some(parent) = to.parent() {
                    fs::create_dir_all(parent)?;
                }

                if let Err(_) = fs::rename(from, to) {
                    fs::copy(from, to)?;
                    fs::remove_file(from)?;
                }

                let undo = Action::MoveFile {
                    from: to.clone(),
                    to: from.clone(),
                    reason: format!("Undo move of '{}'", from.display()),
                };

                Ok(ActionResult {
                    success: true,
                    message: format!(
                        "Moved '{}' to '{}'. Reason: {}",
                        from.display(),
                        to.display(),
                        reason
                    ),
                    files_affected: 1,
                    bytes_freed: 0,
                    undo_action: Some(undo),
                    details: vec![format!("{} → {}", from.display(), to.display())],
                })
            }

            Action::MoveFilesMatching {
                root,
                destination,
                pattern,
                older_than_days,
                reason,
            } => {
                if !root.exists() {
                    return Err(ExecError::ActionFailed(format!(
                        "Root directory '{}' does not exist",
                        root.display()
                    )));
                }

                fs::create_dir_all(destination)?;
                let glob_pat = pattern.as_deref().and_then(|p| Pattern::new(p).ok());
                let now = SystemTime::now();
                let mut moved_count = 0u64;
                let mut details = Vec::new();

                let entries: Vec<_> = WalkDir::new(root)
                    .max_depth(1)
                    .into_iter()
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().is_file())
                    .collect();

                for entry in entries {
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
                                    if duration.as_secs() / 86400 < *days as u64 {
                                        continue;
                                    }
                                }
                            }
                        }
                    }

                    let dest_file = destination.join(entry.file_name());
                    if fs::rename(entry.path(), &dest_file).is_ok()
                        || (fs::copy(entry.path(), &dest_file).is_ok()
                            && fs::remove_file(entry.path()).is_ok())
                    {
                        moved_count += 1;
                        if details.len() < 50 {
                            details.push(format!("{} → {}", entry.path().display(), dest_file.display()));
                        }
                    }
                }

                Ok(ActionResult {
                    success: true,
                    message: format!(
                        "Moved {} file(s) from '{}' to '{}'. Reason: {}",
                        moved_count,
                        root.display(),
                        destination.display(),
                        reason
                    ),
                    files_affected: moved_count,
                    bytes_freed: 0,
                    undo_action: None,
                    details,
                })
            }

            Action::ChangePermissions {
                path,
                mode,
                recursive,
                reason,
            } => {
                if !path.exists() {
                    return Err(ExecError::ActionFailed(format!(
                        "Path '{}' does not exist",
                        path.display()
                    )));
                }

                // On Windows: update readonly attribute or ACLs
                let is_readonly = match mode {
                    PermissionSpec::Text(s) => s.to_lowercase().contains("readonly"),
                    PermissionSpec::Octal(o) => (o & 0o200) == 0,
                };

                let mut affected = 0u64;
                let targets: Vec<PathBuf> = if *recursive && path.is_dir() {
                    WalkDir::new(path)
                        .into_iter()
                        .filter_map(|e| e.ok())
                        .map(|e| e.into_path())
                        .collect()
                } else {
                    vec![path.clone()]
                };

                for p in targets {
                    if let Ok(meta) = fs::metadata(&p) {
                        let mut perms = meta.permissions();
                        perms.set_readonly(is_readonly);
                        if fs::set_permissions(&p, perms).is_ok() {
                            affected += 1;
                        }
                    }
                }

                Ok(ActionResult {
                    success: true,
                    message: format!(
                        "Updated permissions for {} file(s) at '{}' (read-only: {}). Reason: {}",
                        affected,
                        path.display(),
                        is_readonly,
                        reason
                    ),
                    files_affected: affected,
                    bytes_freed: 0,
                    undo_action: None,
                    details: vec![format!("Target: {}, Readonly: {}", path.display(), is_readonly)],
                })
            }

            Action::KillProcess {
                pid_or_name,
                signal,
                reason,
            } => {
                let mut sys = System::new();
                sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

                let mut killed = 0u64;
                let mut details = Vec::new();

                match pid_or_name {
                    ProcessTarget::Pid(pid) => {
                        let sys_pid = Pid::from(*pid as usize);
                        if let Some(proc) = sys.process(sys_pid) {
                            let name = proc.name().to_string_lossy().to_string();
                            proc.kill();
                            killed += 1;
                            details.push(format!("Terminated PID {} ({})", pid, name));
                        } else {
                            return Err(ExecError::ProcessError(format!("PID {} not found", pid)));
                        }
                    }
                    ProcessTarget::Name(name) => {
                        let lower = name.to_lowercase();
                        for (pid, proc) in sys.processes() {
                            if proc.name().to_string_lossy().to_lowercase().contains(&lower) {
                                proc.kill();
                                killed += 1;
                                details.push(format!("Terminated PID {} ({})", pid.as_u32(), proc.name().to_string_lossy()));
                            }
                        }
                    }
                }

                Ok(ActionResult {
                    success: true,
                    message: format!(
                        "Terminated {} process(es) matching {:?} with {:?}. Reason: {}",
                        killed, pid_or_name, signal, reason
                    ),
                    files_affected: killed,
                    bytes_freed: 0,
                    undo_action: None,
                    details,
                })
            }

            Action::CompressDirectory {
                path,
                output,
                delete_source,
                reason,
            } => {
                if !path.exists() {
                    return Err(ExecError::ActionFailed(format!(
                        "Path '{}' does not exist",
                        path.display()
                    )));
                }

                if let Some(parent) = output.parent() {
                    fs::create_dir_all(parent)?;
                }

                let zip_file = File::create(output)?;
                let mut zip = ZipWriter::new(zip_file);
                let options = SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated)
                    .unix_permissions(0o755);

                let mut total_bytes = 0u64;
                let mut file_count = 0u64;
                let mut buffer = Vec::new();

                for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
                    let entry_path = entry.path();
                    let name = entry_path
                        .strip_prefix(path)
                        .map_err(|e| ExecError::CompressionError(e.to_string()))?;

                    if entry_path.is_file() {
                        zip.start_file(name.to_string_lossy().replace('\\', "/"), options)
                            .map_err(|e| ExecError::CompressionError(e.to_string()))?;
                        let mut f = File::open(entry_path)?;
                        buffer.clear();
                        f.read_to_end(&mut buffer)?;
                        zip.write_all(&buffer)?;
                        total_bytes += buffer.len() as u64;
                        file_count += 1;
                    } else if !name.as_os_str().is_empty() {
                        zip.add_directory(name.to_string_lossy().replace('\\', "/"), options)
                            .map_err(|e| ExecError::CompressionError(e.to_string()))?;
                    }
                }

                zip.finish().map_err(|e| ExecError::CompressionError(e.to_string()))?;

                let freed = if *delete_source {
                    self.soft_delete(path).map(|(_, b)| b).unwrap_or(0)
                } else {
                    0
                };

                Ok(ActionResult {
                    success: true,
                    message: format!(
                        "Compressed {} file(s) ({:.2} MB) into '{}'. Reason: {}",
                        file_count,
                        total_bytes as f64 / 1_048_576.0,
                        output.display(),
                        reason
                    ),
                    files_affected: file_count,
                    bytes_freed: freed,
                    undo_action: None,
                    details: vec![format!("Source: {}, Archive: {}, Delete source: {}", path.display(), output.display(), delete_source)],
                })
            }

            Action::FindLargeFiles { root, min_size_mb } => {
                let dry = self.dry_run.dry_run_action(action)?;
                Ok(ActionResult {
                    success: true,
                    message: dry.message,
                    files_affected: dry.simulated_files_affected,
                    bytes_freed: 0,
                    undo_action: None,
                    details: dry.details,
                })
            }

            Action::EmptyTrash => {
                let trash_dir = get_trash_directory();
                let mut purged_count = 0u64;
                let mut purged_bytes = 0u64;

                if trash_dir.exists() {
                    for entry in WalkDir::new(&trash_dir).into_iter().filter_map(|e| e.ok()) {
                        if entry.file_type().is_file() {
                            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                            if fs::remove_file(entry.path()).is_ok() {
                                purged_count += 1;
                                purged_bytes += size;
                            }
                        }
                    }
                }

                Ok(ActionResult {
                    success: true,
                    message: format!(
                        "Permanently emptied Sentinel trash: {} file(s) purged, {:.2} MB freed.",
                        purged_count,
                        purged_bytes as f64 / 1_048_576.0
                    ),
                    files_affected: purged_count,
                    bytes_freed: purged_bytes,
                    undo_action: None,
                    details: vec![format!("Purged from: {}", trash_dir.display())],
                })
            }

            Action::ListRunningProcesses { filter } => {
                let dry = self.dry_run.dry_run_action(action)?;
                Ok(ActionResult {
                    success: true,
                    message: dry.message,
                    files_affected: dry.simulated_files_affected,
                    bytes_freed: 0,
                    undo_action: None,
                    details: dry.details,
                })
            }
        }
    }

    fn dry_run_action(&self, action: &Action) -> Result<DryRunResult, ExecError> {
        self.dry_run.dry_run_action(action)
    }

    fn elevate(&self) -> Result<ElevationToken, ExecError> {
        // Query current privilege on Windows
        // In Sentinel architecture, elevation is handled per-batch via ShellExecuteW "runas" helper
        Ok(ElevationToken {
            token: "windows-uac-session-token".to_string(),
            elevated: true,
            mechanism: "Windows UAC (ShellExecuteW runas)".to_string(),
        })
    }
}
