use thiserror::Error;

#[derive(Error, Debug)]
pub enum SentinelError {
    #[error("Policy violation: {0}")]
    PolicyViolation(String),

    #[error("Execution failed: {0}")]
    ExecutionError(String),

    #[error("Elevation failed: {0}")]
    ElevationError(String),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),

    #[error("I/O error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Plan error: {0}")]
    PlanError(String),

    #[error("Database error: {0}")]
    DatabaseError(String),

    #[error("LLM error: {0}")]
    LlmError(String),

    #[error("Invalid state transition: {0}")]
    StateTransitionError(String),
}
