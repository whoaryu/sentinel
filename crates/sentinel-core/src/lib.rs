pub mod action;
pub mod error;
pub mod schema;

use std::path::{Path, PathBuf};

pub use action::*;
pub use error::SentinelError;

/// Expands leading `~` to the user's home directory (USERPROFILE or HOME)
pub fn expand_tilde_path(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if s.starts_with('~') {
        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            let remainder = s.trim_start_matches('~').trim_start_matches(['/', '\\']);
            return PathBuf::from(home).join(remainder);
        }
    }
    p.to_path_buf()
}
