pub mod action;
pub mod error;
pub mod schema;

use std::path::{Path, PathBuf};

pub use action::*;
pub use error::SentinelError;

/// Expands leading `~` or standard directories to the user's home directory (USERPROFILE or HOME)
pub fn expand_tilde_path(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let home_path = PathBuf::from(&home);
        if s.starts_with('~') {
            let remainder = s.trim_start_matches('~').trim_start_matches(['/', '\\']);
            return home_path.join(remainder);
        }
        let lower = s.to_lowercase();
        let trimmed = lower.trim_start_matches(['.', '/', '\\']);
        if trimmed == "downloads" {
            return home_path.join("Downloads");
        }
        if trimmed == "desktop" {
            return home_path.join("Desktop");
        }
        if trimmed == "documents" {
            return home_path.join("Documents");
        }
    }
    p.to_path_buf()
}
