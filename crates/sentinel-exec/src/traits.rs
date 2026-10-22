use crate::types::{ActionResult, DryRunResult, ElevationToken, ExecError};
use sentinel_core::Action;

pub trait PrivilegedExecutor: Send + Sync {
    fn execute_action(&self, action: &Action) -> Result<ActionResult, ExecError>;
    fn dry_run_action(&self, action: &Action) -> Result<DryRunResult, ExecError>;
    fn elevate(&self) -> Result<ElevationToken, ExecError>;
}
