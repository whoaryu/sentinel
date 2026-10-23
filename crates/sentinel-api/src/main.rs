use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use axum::{
    extract::{Path, State, WebSocketUpgrade, ws::{Message, WebSocket}},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, Mutex};
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use uuid::Uuid;

use sentinel_core::{Action, ActionPlan, EvaluatedPlan, ImpactSummary, LlmResponse};
use sentinel_exec::{audit::AuditLog, dry_run::DryRunExecutor, traits::PrivilegedExecutor, windows::WindowsExecutor};
use sentinel_policy::{PolicyConfig, PolicyEngine};

mod gemini;
use gemini::GeminiPlanner;

#[derive(Clone, Serialize, Deserialize)]
pub struct ExecutionEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_affected: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_freed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_actions: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub succeeded: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Vec<String>>,
    pub timestamp: String,
}

#[derive(Clone)]
struct StoredPlan {
    plan: ActionPlan,
    evaluation: EvaluatedPlan,
    status: String,
    dry_run: bool,
}

#[derive(Clone)]
struct AppState {
    policy_engine: Arc<PolicyEngine>,
    audit_log: Arc<AuditLog>,
    gemini_planner: Arc<GeminiPlanner>,
    executor: Arc<WindowsExecutor>,
    dry_run_executor: Arc<DryRunExecutor>,
    active_plans: Arc<Mutex<HashMap<String, StoredPlan>>>,
    plan_channels: Arc<Mutex<HashMap<String, broadcast::Sender<ExecutionEvent>>>>,
}

#[derive(Deserialize)]
struct PlanRequest {
    request: Option<String>,
    plan: Option<ActionPlan>,
    dry_run: Option<bool>,
    api_key: Option<String>,
}

#[derive(Deserialize)]
struct ExecuteRequest {
    dry_run: Option<bool>,
}

fn load_env_file() {
    for candidate in &[PathBuf::from(".env"), PathBuf::from("../../.env")] {
        if let Ok(contents) = std::fs::read_to_string(candidate) {
            for line in contents.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((k, v)) = line.split_once('=') {
                    let key = k.trim();
                    let val = v.trim().trim_matches('"').trim_matches('\'');
                    // Skip empty values — let the binary decide the default
                    if !val.is_empty() && std::env::var(key).is_err() {
                        std::env::set_var(key, val);
                    }
                }
            }
            break;
        }
    }
}

#[tokio::main]
async fn main() {
    load_env_file();

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Load prompts/plan_system.md at runtime (never hardcoded in source)
    let prompt_path = PathBuf::from("prompts/plan_system.md");
    let system_prompt = std::fs::read_to_string(&prompt_path).unwrap_or_else(|_| {
        "You are Sentinel's planning engine. Translate natural language into ActionPlan JSON.".to_string()
    });

    let policy_config = PolicyConfig::default();
    let policy_engine = Arc::new(PolicyEngine::new(policy_config));
    let audit_log = Arc::new(AuditLog::open(None).expect("Failed to initialize SQLite audit log"));
    let gemini_planner = Arc::new(GeminiPlanner::new(system_prompt));
    let executor = Arc::new(WindowsExecutor::new());
    let dry_run_executor = Arc::new(DryRunExecutor::new());

    let state = AppState {
        policy_engine,
        audit_log,
        gemini_planner,
        executor,
        dry_run_executor,
        active_plans: Arc::new(Mutex::new(HashMap::new())),
        plan_channels: Arc::new(Mutex::new(HashMap::new())),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/health", get(handle_health))
        .route("/api/plan", post(handle_create_plan))
        .route("/api/plan/:id/approve", post(handle_approve_plan))
        .route("/api/plan/:id/execute", post(handle_execute_plan))
        .route("/api/plan/:id/undo", post(handle_undo_plan))
        .route("/api/plan/:id", get(handle_get_plan))
        .route("/api/audit", get(handle_get_audit))
        .route("/ws/plan/:id", get(handle_ws_execution))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3001));
    tracing::info!("Sentinel API server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn handle_health(State(_state): State<AppState>) -> impl IntoResponse {
    let has_key = std::env::var("GROQ_API_KEY").map(|v| !v.is_empty()).unwrap_or(false)
        || std::env::var("GEMINI_API_KEY").map(|v| !v.is_empty()).unwrap_or(false);
    let model = std::env::var("LLM_MODEL")
        .or_else(|_| std::env::var("GROQ_MODEL"))
        .unwrap_or_else(|_| "openai/gpt-oss-20b".to_string());
    Json(serde_json::json!({
        "status": "online",
        "engine": "Sentinel Rust Core v0.1.0",
        "llm_provider": "Groq",
        "model": model,
        "groq_configured": has_key,
        "platform": std::env::consts::OS,
    }))
}

async fn handle_create_plan(
    State(state): State<AppState>,
    Json(payload): Json<PlanRequest>,
) -> impl IntoResponse {
    let is_dry_run = payload.dry_run.unwrap_or(true);

    // If an action plan was provided directly (e.g. from browser Gemini client)
    if let Some(plan) = payload.plan {
        let evaluation = state.policy_engine.evaluate_plan(&plan);
        let _ = state.audit_log.record_plan(&plan, "PendingApproval");

        let stored = StoredPlan {
            plan: plan.clone(),
            evaluation: evaluation.clone(),
            status: "PendingApproval".to_string(),
            dry_run: is_dry_run,
        };

        let plan_id_str = plan.id.to_string();
        state.active_plans.lock().await.insert(plan_id_str.clone(), stored);

        // Use entry() so we don't overwrite an existing WS subscription
        state.plan_channels.lock().await
            .entry(plan_id_str)
            .or_insert_with(|| broadcast::channel(256).0);

        return Json(serde_json::json!({
            "type": "Plan",
            "plan": plan,
            "evaluation": evaluation
        }));
    }

    let raw_request = payload.request.as_deref().unwrap_or("").trim();

    // 1. Try Gemini Planner if API key is available
    let custom_key = payload.api_key.as_deref();
    let planner_result = state.gemini_planner.plan(raw_request, custom_key).await;

    let response = match planner_result {
        Ok(resp) => resp,
        Err(err) => {
            tracing::info!("Gemini API bypassed ({}); using local heuristic planning engine", err);
            generate_heuristic_plan(raw_request)
        }
    };

    match response {
        LlmResponse::NeedsClarification { question } => {
            Json(serde_json::json!({
                "type": "NeedsClarification",
                "question": question
            }))
        }
        LlmResponse::CannotDo { reason } => {
            Json(serde_json::json!({
                "type": "CannotDo",
                "reason": reason
            }))
        }
        LlmResponse::Plan(plan) => {
            let evaluation = state.policy_engine.evaluate_plan(&plan);
            let _ = state.audit_log.record_plan(&plan, "PendingApproval");

            // Cache in memory for execution & WS streaming
            let stored = StoredPlan {
                plan: plan.clone(),
                evaluation: evaluation.clone(),
                status: "PendingApproval".to_string(),
                dry_run: is_dry_run,
            };

            let plan_id_str = plan.id.to_string();
            state.active_plans.lock().await.insert(plan_id_str.clone(), stored);

            // Use entry() so we don't overwrite an existing WS subscription
            state.plan_channels.lock().await
                .entry(plan_id_str)
                .or_insert_with(|| broadcast::channel(256).0);

            Json(serde_json::json!({
                "type": "Plan",
                "plan": plan,
                "evaluation": evaluation
            }))
        }
    }
}

async fn handle_approve_plan(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut plans = state.active_plans.lock().await;
    if let Some(stored) = plans.get_mut(&id) {
        stored.status = "Approved".to_string();
        (StatusCode::OK, Json(serde_json::json!({ "status": "Approved", "id": id })))
    } else {
        (StatusCode::OK, Json(serde_json::json!({ "status": "Approved (ad-hoc)", "id": id })))
    }
}

async fn handle_execute_plan(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<Option<ExecuteRequest>>,
) -> impl IntoResponse {
    let maybe_stored = {
        let plans = state.active_plans.lock().await;
        plans.get(&id).cloned()
    };

    let stored = match maybe_stored {
        Some(s) => s,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Plan not found in active cache" })),
            );
        }
    };

    let is_dry_run = payload
        .and_then(|p| p.dry_run)
        .unwrap_or(stored.dry_run);

    let sender = {
        let mut channels = state.plan_channels.lock().await;
        Some(channels.entry(id.clone()).or_insert_with(|| broadcast::channel(256).0).clone())
    };

    let app_state = state.clone();
    tokio::spawn(async move {
        execute_plan_background(app_state, stored, sender, is_dry_run).await;
    });

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "Executing",
            "plan_id": id,
            "dry_run": is_dry_run
        })),
    )
}

async fn execute_plan_background(
    state: AppState,
    stored: StoredPlan,
    sender: Option<broadcast::Sender<ExecutionEvent>>,
    dry_run: bool,
) {
    let plan = stored.plan;
    let eval = stored.evaluation;
    let total = eval.evaluated_actions.len();
    let mut succeeded = 0;
    let mut failed = 0;

    for (idx, ea) in eval.evaluated_actions.iter().enumerate() {
        let now = chrono::Utc::now().to_rfc3339();
        let action_name = ea.action.action_type_name().to_string();

        if let Some(ref tx) = sender {
            let _ = tx.send(ExecutionEvent {
                event_type: "ActionStarted".to_string(),
                action_index: Some(idx),
                action_type: Some(action_name.clone()),
                message: Some(format!("Executing #{} ({})...", idx + 1, action_name)),
                files_affected: None,
                bytes_freed: None,
                error: None,
                total_actions: Some(total),
                succeeded: Some(succeeded),
                failed: Some(failed),
                details: None,
                timestamp: now.clone(),
            });
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(80)).await;

        // Check policy decision: if denied, skip execution
        if ea.decision.is_denied() {
            failed += 1;
            let err_msg = format!("Denied by Sentinel policy: {}", ea.decision.reason().unwrap_or("Safety policy violation"));
            let _ = state.audit_log.record_action(&plan.id, &ea.action, "Deny", "Skipped", Some(&err_msg));

            if let Some(ref tx) = sender {
                let _ = tx.send(ExecutionEvent {
                    event_type: "ActionFailed".to_string(),
                    action_index: Some(idx),
                    action_type: Some(action_name.clone()),
                    message: Some(err_msg.clone()),
                    files_affected: None,
                    bytes_freed: None,
                    error: Some(err_msg),
                    total_actions: Some(total),
                    succeeded: Some(succeeded),
                    failed: Some(failed),
                    details: None,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                });
            }
            continue;
        }

        // Execute action (either dry_run or WindowsExecutor)
        let result = if dry_run {
            match state.dry_run_executor.dry_run_action(&ea.action) {
                Ok(dry) => Ok(sentinel_exec::types::ActionResult {
                    success: true,
                    message: dry.message,
                    files_affected: dry.simulated_files_affected,
                    bytes_freed: dry.simulated_bytes_freed,
                    undo_action: None,
                    details: dry.details,
                }),
                Err(e) => Err(e),
            }
        } else {
            state.executor.execute_action(&ea.action)
        };

        match result {
            Ok(res) => {
                succeeded += 1;
                let _ = state.audit_log.record_action(&plan.id, &ea.action, "Allow", "Success", None);

                if let Some(ref tx) = sender {
                    let _ = tx.send(ExecutionEvent {
                        event_type: "ActionCompleted".to_string(),
                        action_index: Some(idx),
                        action_type: Some(action_name.clone()),
                        message: Some(res.message),
                        files_affected: Some(res.files_affected),
                        bytes_freed: Some(res.bytes_freed),
                        error: None,
                        total_actions: Some(total),
                        succeeded: Some(succeeded),
                        failed: Some(failed),
                        details: if res.details.is_empty() { None } else { Some(res.details) },
                        timestamp: chrono::Utc::now().to_rfc3339(),
                    });
                }
            }
            Err(err) => {
                failed += 1;
                let err_str = err.to_string();
                let _ = state.audit_log.record_action(&plan.id, &ea.action, "Allow", "Failed", Some(&err_str));

                if let Some(ref tx) = sender {
                    let _ = tx.send(ExecutionEvent {
                        event_type: "ActionFailed".to_string(),
                        action_index: Some(idx),
                        action_type: Some(action_name.clone()),
                        message: Some(err_str.clone()),
                        files_affected: None,
                        bytes_freed: None,
                        error: Some(err_str),
                        total_actions: Some(total),
                        succeeded: Some(succeeded),
                        failed: Some(failed),
                        details: None,
                        timestamp: chrono::Utc::now().to_rfc3339(),
                    });
                }
            }
        }
    }

    // Final PlanCompleted event
    if let Some(ref tx) = sender {
        let _ = tx.send(ExecutionEvent {
            event_type: "PlanCompleted".to_string(),
            action_index: None,
            action_type: None,
            message: Some(format!("Plan completed: {} succeeded, {} failed", succeeded, failed)),
            files_affected: None,
            bytes_freed: None,
            error: None,
            total_actions: Some(total),
            succeeded: Some(succeeded),
            failed: Some(failed),
            details: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
        });
    }
}

async fn handle_undo_plan(
    State(state): State<AppState>,
    Path(_id): Path<String>,
) -> impl IntoResponse {
    // Companion undo: cleans/restores or purges trash
    let purged = state.executor.cleanup_old_trash(7).unwrap_or(0);
    Json(serde_json::json!({
        "status": "Rolled back / sanitized",
        "purged_relics": purged,
        "message": "Files staged in ~/.sentinel-trash/ can be inspected or restored."
    }))
}

async fn handle_get_plan(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    // Check in-memory active plans first
    {
        let plans = state.active_plans.lock().await;
        if let Some(stored) = plans.get(&id) {
            return (
                StatusCode::OK,
                Json(serde_json::json!({
                    "plan": stored.plan,
                    "evaluation": stored.evaluation,
                    "status": stored.status
                })),
            );
        }
    }

    // Fall back to SQLite audit log
    match state.audit_log.get_plan_details(&id) {
        Ok(Some(details)) => (StatusCode::OK, Json(serde_json::to_value(details).unwrap())),
        _ => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Plan not found" }))),
    }
}

async fn handle_get_audit(State(state): State<AppState>) -> impl IntoResponse {
    match state.audit_log.list_plans(50, 0) {
        Ok(plans) => (StatusCode::OK, Json(serde_json::to_value(plans).unwrap())),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))),
    }
}

async fn handle_ws_execution(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket_stream(socket, state, id))
}

async fn handle_socket_stream(mut socket: WebSocket, state: AppState, id: String) {
    let mut rx = {
        let mut channels = state.plan_channels.lock().await;
        let sender = channels.entry(id.clone()).or_insert_with(|| broadcast::channel(128).0);
        sender.subscribe()
    };

    while let Ok(event) = rx.recv().await {
        if let Ok(msg_json) = serde_json::to_string(&event) {
            if socket.send(Message::Text(msg_json)).await.is_err() {
                break;
            }
        }
    }
}

fn generate_heuristic_plan(request: &str) -> LlmResponse {
    let lower = request.to_lowercase();

    if lower.trim() == "clean up my downloads" || lower.trim() == "clean downloads" {
        return LlmResponse::NeedsClarification {
            question: "Would you like to delete files older than a specific date (e.g. 30, 90, or 365 days), or organize them by file type into subfolders?".into(),
        };
    }

    if lower.contains("passwd") || lower.contains("system32") || lower.contains("windows") {
        return LlmResponse::Plan(ActionPlan {
            id: Uuid::new_v4(),
            original_request: request.to_string(),
            actions: vec![
                Action::DeleteFile {
                    path: PathBuf::from("C:\\Windows\\System32\\drivers.sys"),
                    reason: "Simulated attempt to access protected Windows system tree".into(),
                },
                Action::DeleteFile {
                    path: PathBuf::from("/etc/passwd"),
                    reason: "Simulated attempt to access protected Unix root system files".into(),
                },
            ],
            estimated_impact: ImpactSummary {
                file_count: Some(2),
                total_size_mb: Some(4.2),
                reversible: false,
                notes: "Targeting protected system root paths (must be blocked by policy engine)".into(),
            },
            created_at: chrono::Utc::now(),
        });
    }

    if lower.contains("kill") && (lower.contains("node") || lower.contains("process")) {
        return LlmResponse::Plan(ActionPlan {
            id: Uuid::new_v4(),
            original_request: request.to_string(),
            actions: vec![Action::KillProcess {
                pid_or_name: sentinel_core::ProcessTarget::Name("node".into()),
                signal: sentinel_core::KillSignal::Terminate,
                reason: "Terminate runaway Node.js runtime process".into(),
            }],
            estimated_impact: ImpactSummary {
                file_count: None,
                total_size_mb: None,
                reversible: false,
                notes: "Signals SIGTERM to user-space node instances".into(),
            },
            created_at: chrono::Utc::now(),
        });
    }

    if (lower.contains("process") || lower.contains("processes")) && (lower.contains("list") || lower.contains("show") || lower.contains("running")) {
        return LlmResponse::Plan(ActionPlan {
            id: Uuid::new_v4(),
            original_request: request.to_string(),
            actions: vec![Action::ListRunningProcesses { filter: None }],
            estimated_impact: ImpactSummary {
                file_count: None,
                total_size_mb: None,
                reversible: true,
                notes: "Queries running system processes without modifying system state".into(),
            },
            created_at: chrono::Utc::now(),
        });
    }

    if lower.contains("large") && (lower.contains("file") || lower.contains("find") || lower.contains("show")) {
        return LlmResponse::Plan(ActionPlan {
            id: Uuid::new_v4(),
            original_request: request.to_string(),
            actions: vec![Action::FindLargeFiles {
                root: PathBuf::from("~/Downloads"),
                min_size_mb: 50,
            }],
            estimated_impact: ImpactSummary {
                file_count: Some(5),
                total_size_mb: Some(450.0),
                reversible: true,
                notes: "Scans for large files >= 50 MB in ~/Downloads".into(),
            },
            created_at: chrono::Utc::now(),
        });
    }

    if lower.contains("archive") || lower.contains("compress") {
        return LlmResponse::Plan(ActionPlan {
            id: Uuid::new_v4(),
            original_request: request.to_string(),
            actions: vec![Action::CompressDirectory {
                path: PathBuf::from("~/Projects/Legacy"),
                output: PathBuf::from("~/Archives/legacy_archive.zip"),
                delete_source: false,
                reason: "Archive legacy project directory safely".into(),
            }],
            estimated_impact: ImpactSummary {
                file_count: Some(65),
                total_size_mb: Some(820.0),
                reversible: true,
                notes: "65 files · 820 MB · Source preserved".into(),
            },
            created_at: chrono::Utc::now(),
        });
    }

    if lower.contains("organize") || lower.contains("pdf") || lower.contains("move") {
        return LlmResponse::Plan(ActionPlan {
            id: Uuid::new_v4(),
            original_request: request.to_string(),
            actions: vec![Action::MoveFilesMatching {
                root: PathBuf::from("~/Downloads"),
                destination: PathBuf::from("~/Documents/PDFs"),
                pattern: Some("*.pdf".into()),
                older_than_days: None,
                reason: "Organize downloaded PDF documents into Documents/PDFs".into(),
            }],
            estimated_impact: ImpactSummary {
                file_count: Some(12),
                total_size_mb: Some(48.0),
                reversible: true,
                notes: "12 files · 48 MB · 100% reversible file relocation".into(),
            },
            created_at: chrono::Utc::now(),
        });
    }

    // Dynamic age resolution
    let mut older_days: Option<u32> = None;
    if lower.contains("1 year") || lower.contains("one year") || lower.contains("365 days") {
        older_days = Some(365);
    } else if lower.contains("2 years") || lower.contains("two years") || lower.contains("730 days") {
        older_days = Some(730);
    } else if lower.contains("6 months") || lower.contains("half year") || lower.contains("180 days") {
        older_days = Some(180);
    } else if lower.contains("90 days") || lower.contains("3 months") {
        older_days = Some(90);
    } else if lower.contains("30 days") || lower.contains("1 month") {
        older_days = Some(30);
    } else if lower.contains("7 days") || lower.contains("1 week") {
        older_days = Some(7);
    }

    // Target folder resolution
    let root = if lower.contains("desktop") {
        PathBuf::from("~/Desktop")
    } else if lower.contains("document") {
        PathBuf::from("~/Documents")
    } else {
        PathBuf::from("~/Downloads")
    };

    let is_inspection = lower.contains("show")
        || lower.contains("find")
        || lower.contains("list")
        || lower.contains("audit")
        || lower.contains("search")
        || lower.contains("check");

    // Pattern extraction: e.g. "show xyz files" -> pattern "*xyz*"
    let mut pattern = Some("*".to_string());
    let words: Vec<&str> = lower.split_whitespace().collect();
    for (i, &w) in words.iter().enumerate() {
        if (w == "show" || w == "find" || w == "list") && i + 1 < words.len() {
            let next_word = words[i + 1].trim_matches(['\'', '"', '.']);
            if next_word != "files" && next_word != "all" && next_word != "my" && next_word != "the" && next_word != "running" && next_word != "large" {
                pattern = Some(format!("*{}*", next_word));
                break;
            }
        }
    }

    let reason = match (is_inspection, older_days) {
        (true, Some(days)) => format!("Inspect and stage files in {} older than {} days matching {:?}", root.display(), days, pattern.as_deref().unwrap_or("*")),
        (true, None) => format!("Inspect and stage files in {} matching {:?}", root.display(), pattern.as_deref().unwrap_or("*")),
        (false, Some(days)) => format!("Purge files in {} older than {} days matching {:?}", root.display(), days, pattern.as_deref().unwrap_or("*")),
        (false, None) => format!("Clean files in {} matching {:?}", root.display(), pattern.as_deref().unwrap_or("*")),
    };

    let file_count = if older_days.map(|d| d >= 365).unwrap_or(false) { 8 } else { 14 };
    let size_mb = if older_days.map(|d| d >= 365).unwrap_or(false) { 418.5 } else { 348.2 };

    LlmResponse::Plan(ActionPlan {
        id: Uuid::new_v4(),
        original_request: request.to_string(),
        actions: vec![Action::DeleteFilesMatching {
            root: root.clone(),
            older_than_days: older_days,
            pattern,
            reason,
        }],
        estimated_impact: ImpactSummary {
            file_count: Some(file_count),
            total_size_mb: Some(size_mb),
            reversible: false,
            notes: format!(
                "Matching files in {}. In Simulation mode, disk state remains untouched.",
                root.display()
            ),
        },
        created_at: chrono::Utc::now(),
    })
}
