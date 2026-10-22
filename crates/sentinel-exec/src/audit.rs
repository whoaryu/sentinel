use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::types::ExecError;
use sentinel_core::{Action, ActionPlan};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuditPlanRecord {
    pub id: String,
    pub request: String,
    pub plan_json: String,
    pub status: String,
    pub created_at: String,
    pub approved_at: Option<String>,
    pub executed_at: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuditActionRecord {
    pub id: String,
    pub plan_id: String,
    pub action_type: String,
    pub action_json: String,
    pub policy: String,
    pub result: Option<String>,
    pub error: Option<String>,
    pub executed_at: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuditPlanWithActions {
    pub plan: AuditPlanRecord,
    pub actions: Vec<AuditActionRecord>,
}

#[derive(Clone)]
pub struct AuditLog {
    conn: Arc<Mutex<Connection>>,
    db_path: PathBuf,
}

impl AuditLog {
    pub fn open(custom_path: Option<PathBuf>) -> Result<Self, ExecError> {
        let path = match custom_path {
            Some(p) => p,
            None => {
                let base = if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
                    PathBuf::from(home).join(".sentinel")
                } else {
                    std::env::temp_dir().join(".sentinel")
                };
                std::fs::create_dir_all(&base)?;
                base.join("audit.db")
            }
        };

        let conn = Connection::open(&path).map_err(|e| ExecError::DatabaseError(e.to_string()))?;
        let audit = Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path: path,
        };

        audit.init_schema()?;
        Ok(audit)
    }

    pub fn in_memory() -> Result<Self, ExecError> {
        let conn = Connection::open_in_memory().map_err(|e| ExecError::DatabaseError(e.to_string()))?;
        let audit = Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path: PathBuf::from(":memory:"),
        };
        audit.init_schema()?;
        Ok(audit)
    }

    fn init_schema(&self) -> Result<(), ExecError> {
        let conn = self.conn.lock().unwrap();

        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS audit_plans (
                id          TEXT PRIMARY KEY,
                request     TEXT NOT NULL,
                plan_json   TEXT NOT NULL,
                status      TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                approved_at TEXT,
                executed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS audit_actions (
                id          TEXT PRIMARY KEY,
                plan_id     TEXT NOT NULL,
                action_type TEXT NOT NULL,
                action_json TEXT NOT NULL,
                policy      TEXT NOT NULL,
                result      TEXT,
                error       TEXT,
                executed_at TEXT
            );

            -- Append-only triggers: abort any UPDATE or DELETE attempt
            CREATE TRIGGER IF NOT EXISTS no_update_plans
            BEFORE UPDATE ON audit_plans
            BEGIN
                SELECT RAISE(ABORT, 'audit log is append-only');
            END;

            CREATE TRIGGER IF NOT EXISTS no_delete_plans
            BEFORE DELETE ON audit_plans
            BEGIN
                SELECT RAISE(ABORT, 'audit log is append-only');
            END;

            CREATE TRIGGER IF NOT EXISTS no_update_actions
            BEFORE UPDATE ON audit_actions
            BEGIN
                SELECT RAISE(ABORT, 'audit log is append-only');
            END;

            CREATE TRIGGER IF NOT EXISTS no_delete_actions
            BEFORE DELETE ON audit_actions
            BEGIN
                SELECT RAISE(ABORT, 'audit log is append-only');
            END;
            "#,
        )
        .map_err(|e| ExecError::DatabaseError(format!("Failed to initialize audit schema: {}", e)))?;

        Ok(())
    }

    pub fn record_plan(&self, plan: &ActionPlan, status: &str) -> Result<(), ExecError> {
        let conn = self.conn.lock().unwrap();
        let plan_json = serde_json::to_string(plan).map_err(|e| ExecError::SerializationError(e))?;
        let now = Utc::now().to_rfc3339();

        let approved_at = if status == "Approved" || status == "Executed" {
            Some(now.clone())
        } else {
            None
        };

        let executed_at = if status == "Executed" || status == "Failed" {
            Some(now.clone())
        } else {
            None
        };

        conn.execute(
            "INSERT INTO audit_plans (id, request, plan_json, status, created_at, approved_at, executed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                plan.id.to_string(),
                plan.original_request,
                plan_json,
                status,
                plan.created_at.to_rfc3339(),
                approved_at,
                executed_at,
            ],
        )
        .map_err(|e| ExecError::DatabaseError(format!("Failed to record audit plan: {}", e)))?;

        Ok(())
    }

    pub fn record_action(
        &self,
        plan_id: &Uuid,
        action: &Action,
        policy: &str,
        result: &str,
        error: Option<&str>,
    ) -> Result<(), ExecError> {
        let conn = self.conn.lock().unwrap();
        let action_id = Uuid::new_v4().to_string();
        let action_type = action.action_type_name().to_string();
        let action_json = serde_json::to_string(action).map_err(|e| ExecError::SerializationError(e))?;
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO audit_actions (id, plan_id, action_type, action_json, policy, result, error, executed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                action_id,
                plan_id.to_string(),
                action_type,
                action_json,
                policy,
                result,
                error,
                now,
            ],
        )
        .map_err(|e| ExecError::DatabaseError(format!("Failed to record audit action: {}", e)))?;

        Ok(())
    }

    pub fn list_plans(&self, limit: usize, offset: usize) -> Result<Vec<AuditPlanRecord>, ExecError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, request, plan_json, status, created_at, approved_at, executed_at FROM audit_plans ORDER BY created_at DESC LIMIT ?1 OFFSET ?2")
            .map_err(|e| ExecError::DatabaseError(e.to_string()))?;

        let rows = stmt
            .query_map(params![limit as i64, offset as i64], |row| {
                Ok(AuditPlanRecord {
                    id: row.get(0)?,
                    request: row.get(1)?,
                    plan_json: row.get(2)?,
                    status: row.get(3)?,
                    created_at: row.get(4)?,
                    approved_at: row.get(5)?,
                    executed_at: row.get(6)?,
                })
            })
            .map_err(|e| ExecError::DatabaseError(e.to_string()))?;

        let mut list = Vec::new();
        for r in rows {
            if let Ok(rec) = r {
                list.push(rec);
            }
        }
        Ok(list)
    }

    pub fn get_plan_details(&self, plan_id: &str) -> Result<Option<AuditPlanWithActions>, ExecError> {
        let conn = self.conn.lock().unwrap();

        let plan_opt = conn
            .query_row(
                "SELECT id, request, plan_json, status, created_at, approved_at, executed_at FROM audit_plans WHERE id = ?1",
                params![plan_id],
                |row| {
                    Ok(AuditPlanRecord {
                        id: row.get(0)?,
                        request: row.get(1)?,
                        plan_json: row.get(2)?,
                        status: row.get(3)?,
                        created_at: row.get(4)?,
                        approved_at: row.get(5)?,
                        executed_at: row.get(6)?,
                    })
                },
            )
            .ok();

        let plan = match plan_opt {
            Some(p) => p,
            None => return Ok(None),
        };

        let mut stmt = conn
            .prepare("SELECT id, plan_id, action_type, action_json, policy, result, error, executed_at FROM audit_actions WHERE plan_id = ?1 ORDER BY executed_at ASC")
            .map_err(|e| ExecError::DatabaseError(e.to_string()))?;

        let rows = stmt
            .query_map(params![plan_id], |row| {
                Ok(AuditActionRecord {
                    id: row.get(0)?,
                    plan_id: row.get(1)?,
                    action_type: row.get(2)?,
                    action_json: row.get(3)?,
                    policy: row.get(4)?,
                    result: row.get(5)?,
                    error: row.get(6)?,
                    executed_at: row.get(7)?,
                })
            })
            .map_err(|e| ExecError::DatabaseError(e.to_string()))?;

        let mut actions = Vec::new();
        for r in rows {
            if let Ok(act) = r {
                actions.push(act);
            }
        }

        Ok(Some(AuditPlanWithActions { plan, actions }))
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use sentinel_core::{ImpactSummary, ActionPlan};

    #[test]
    fn test_append_only_prevent_update() {
        let log = AuditLog::in_memory().unwrap();
        let plan_id = Uuid::new_v4();
        let plan = ActionPlan {
            id: plan_id,
            original_request: "Test request".into(),
            actions: vec![],
            estimated_impact: ImpactSummary {
                file_count: Some(1),
                total_size_mb: Some(1.0),
                reversible: true,
                notes: "Test".into(),
            },
            created_at: Utc::now(),
        };

        log.record_plan(&plan, "PendingApproval").unwrap();

        // Attempt direct UPDATE -> MUST FAIL via trigger
        let conn = log.conn.lock().unwrap();
        let res = conn.execute("UPDATE audit_plans SET status = 'Hacked' WHERE id = ?1", params![plan_id.to_string()]);
        assert!(res.is_err());
        let err_msg = res.unwrap_err().to_string();
        assert!(err_msg.contains("audit log is append-only"));
    }

    #[test]
    fn test_append_only_prevent_delete() {
        let log = AuditLog::in_memory().unwrap();
        let plan_id = Uuid::new_v4();
        let plan = ActionPlan {
            id: plan_id,
            original_request: "Delete test".into(),
            actions: vec![],
            estimated_impact: ImpactSummary {
                file_count: None,
                total_size_mb: None,
                reversible: true,
                notes: "".into(),
            },
            created_at: Utc::now(),
        };

        log.record_plan(&plan, "Executed").unwrap();

        // Attempt direct DELETE -> MUST FAIL via trigger
        let conn = log.conn.lock().unwrap();
        let res = conn.execute("DELETE FROM audit_plans WHERE id = ?1", params![plan_id.to_string()]);
        assert!(res.is_err());
        let err_msg = res.unwrap_err().to_string();
        assert!(err_msg.contains("audit log is append-only"));
    }
}
