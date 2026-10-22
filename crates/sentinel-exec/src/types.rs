use sentinel_core::Action;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ExecError {
    #[error("Action execution failed: {0}")]
    ActionFailed(String),

    #[error("I/O error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Process operation failed: {0}")]
    ProcessError(String),

    #[error("Elevation failed: {0}")]
    ElevationFailed(String),

    #[error("Database error: {0}")]
    DatabaseError(String),

    #[error("Compression error: {0}")]
    CompressionError(String),

    #[error("Platform unsupported: {0}")]
    UnsupportedPlatform(String),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ActionResult {
    pub success: bool,
    pub message: String,
    pub files_affected: u64,
    pub bytes_freed: u64,
    pub undo_action: Option<Action>,
    pub details: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct DryRunResult {
    pub message: String,
    pub simulated_files_affected: u64,
    pub simulated_bytes_freed: u64,
    pub details: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ElevationToken {
    pub token: String,
    pub elevated: bool,
    pub mechanism: String,
}
