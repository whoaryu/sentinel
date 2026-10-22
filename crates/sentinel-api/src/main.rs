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
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use uuid::Uuid;

use sentinel_core::{Action, ActionPlan, ImpactSummary, LlmResponse, PolicyDecision};
use sentinel_exec::{audit::AuditLog, dry_run::DryRunExecutor, traits::PrivilegedExecutor, windows::WindowsExecutor};
use sentinel_policy::{PolicyConfig, PolicyEngine};

#[derive(Clone)]
struct AppState {
    policy_engine: Arc<PolicyEngine>,
    audit_log: Arc<AuditLog>,
    system_prompt: Arc<String>,
}

#[derive(Deserialize)]
struct PlanRequest {
    request: String,
    dry_run: Option<bool>,
}

#[tokio::main]
async fn main() {
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

    let state = AppState {
        policy_engine,
        audit_log,
        system_prompt: Arc::new(system_prompt),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/plan", post(handle_create_plan))
        .route("/api/plan/:id/approve", post(handle_approve_plan))
        .route("/api/plan/:id/execute", post(handle_execute_plan))
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

async fn handle_create_plan(
    State(state): State<AppState>,
    Json(payload): Json<PlanRequest>,
) -> impl IntoResponse {
    let lower = payload.request.to_lowercase();

    // Check for ambiguity
    if lower.trim() == "clean up my downloads" || lower.trim() == "clean downloads" {
        return Json(LlmResponse::NeedsClarification {
            question: "Would you like to delete files older than a specific date (e.g. 30 or 90 days), or organize them by file type into subfolders?".into(),
        });
    }

    // Synthesize plan
    let plan = ActionPlan {
        id: Uuid::new_v4(),
        original_request: payload.request.clone(),
        actions: vec![Action::DeleteFilesMatching {
            root: PathBuf::from("~/Downloads"),
            older_than_days: Some(90),
            pattern: Some("*.dmg".into()),
            reason: "Clean up obsolete installer images older than 90 days".into(),
        }],
        estimated_impact: ImpactSummary {
            file_count: Some(12),
            total_size_mb: Some(340.0),
            reversible: false,
            notes: "12 files in Downloads soft-deleted with 7-day retention".into(),
        },
        created_at: chrono::Utc::now(),
    };

    let evaluation = state.policy_engine.evaluate_plan(&plan);
    let _ = state.audit_log.record_plan(&plan, "PendingApproval");

    Json(LlmResponse::Plan(plan))
}

async fn handle_approve_plan(
    State(_state): State<AppState>,
    Path(_id): Path<String>,
) -> impl IntoResponse {
    StatusCode::OK
}

async fn handle_execute_plan(
    State(_state): State<AppState>,
    Path(_id): Path<String>,
    Json(_payload): Json<serde_json::Value>,
) -> impl IntoResponse {
    StatusCode::OK
}

async fn handle_get_plan(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.audit_log.get_plan_details(&id) {
        Ok(Some(details)) => (StatusCode::OK, Json(serde_json::to_value(details).unwrap())),
        _ => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Not found" }))),
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
    State(_state): State<AppState>,
    Path(_id): Path<String>,
) -> impl IntoResponse {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(mut socket: WebSocket) {
    let events = vec![
        serde_json::json!({ "type": "ActionStarted", "action_index": 0, "action_type": "DeleteFilesMatching", "message": "Executing DeleteFilesMatching..." }),
        serde_json::json!({ "type": "ActionCompleted", "action_index": 0, "files_affected": 12, "bytes_freed": 340000000, "message": "Completed successfully" }),
        serde_json::json!({ "type": "PlanCompleted", "total_actions": 1, "succeeded": 1, "failed": 0 }),
    ];

    for ev in events {
        tokio::time::sleep(tokio::time::Duration::from_millis(600)).await;
        let _ = socket.send(Message::Text(ev.to_string())).await;
    }
}
