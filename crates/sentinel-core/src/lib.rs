pub mod action;
pub mod error;
pub mod schema;

use std::path::{Path, PathBuf};

pub use action::*;
pub use error::SentinelError;

/// Expands leading `~` or standard directories to the user's home directory (USERPROFILE or HOME)
/// Seamlessly supports Windows, Linux, and Android (Termux, /sdcard/Download).
pub fn expand_tilde_path(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .or_else(|_| {
            if Path::new("/data/data/com.termux/files/home").exists() {
                Ok("/data/data/com.termux/files/home".to_string())
            } else if Path::new("/sdcard").exists() {
                Ok("/sdcard".to_string())
            } else {
                Err(std::env::VarError::NotPresent)
            }
        });

    if let Ok(home_str) = home {
        let home_path = PathBuf::from(&home_str);
        if s.starts_with('~') {
            let remainder = s.trim_start_matches('~').trim_start_matches(['/', '\\']);
            return home_path.join(remainder);
        }
        let lower = s.to_lowercase();
        let trimmed = lower.trim_start_matches(['.', '/', '\\']);
        if trimmed == "downloads" {
            let sd_download = PathBuf::from("/sdcard/Download");
            if sd_download.exists() {
                return sd_download;
            }
            let emulated_download = PathBuf::from("/storage/emulated/0/Download");
            if emulated_download.exists() {
                return emulated_download;
            }
            return home_path.join("Downloads");
        }
        if trimmed == "desktop" {
            return home_path.join("Desktop");
        }
        if trimmed == "documents" {
            let sd_docs = PathBuf::from("/sdcard/Documents");
            if sd_docs.exists() {
                return sd_docs;
            }
            return home_path.join("Documents");
        }
    }
    p.to_path_buf()
}
