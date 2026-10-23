pub mod audit;
pub mod dry_run;
pub mod traits;
pub mod types;
pub mod windows;

pub use audit::{AuditActionRecord, AuditLog, AuditPlanRecord, AuditPlanWithActions};
pub use dry_run::DryRunExecutor;
pub use traits::PrivilegedExecutor;
pub use types::{ActionResult, DryRunResult, ElevationToken, ExecError};
pub use windows::{NativeExecutor, WindowsExecutor};
