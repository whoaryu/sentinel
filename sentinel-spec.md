# Sentinel — AI Coding Agent Spec

## What We're Building

Sentinel is a local desktop tool (Rust backend + React frontend, both running on the user's machine) that lets users type natural language commands to perform privileged OS operations. The LLM translates NL into a strictly-typed action plan. A Rust policy engine validates it. The user reviews and approves. A Rust execution engine runs it with OS-level elevation.

**Hard rule: the LLM never executes anything. It only produces structured, typed JSON.**

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Core types | Rust (`sentinel-core` crate) | `serde`, `uuid`, `chrono`, `thiserror` |
| Policy engine | Rust (`sentinel-policy` crate) | Pure, sync, no IO |
| Execution engine | Rust (`sentinel-exec` crate) | OS-specific backends behind one trait |
| API server | Rust + Axum (`sentinel-api` crate) | REST + WebSocket |
| LLM | Claude API (structured outputs / tool use) | `schemars` to generate JSON schema from Rust types |
| Audit log | SQLite via `sqlx` | Append-only, trigger prevents UPDATE/DELETE |
| Frontend | React + Vite | Proxies `/api/*` to Axum on port 3001 |
| OS (Linux) | `nix` crate + `pkexec` | POSIX permissions, signals, Polkit elevation |
| OS (Windows) | `windows-rs` | Win32 ACLs, UAC via ShellExecuteW "runas" |

**Build target OS first:** implement fully on whichever OS you develop on. Stub other backends with `unimplemented!()` and document the approach.

---

## Cargo Workspace Structure

```
sentinel/
├── Cargo.toml                  # workspace
├── crates/
│   ├── sentinel-core/          # shared types: Action, ActionPlan, PolicyDecision
│   ├── sentinel-policy/        # policy engine, depends on core
│   ├── sentinel-exec/          # execution engine, depends on core
│   └── sentinel-api/           # Axum server, depends on all above
├── frontend/                   # React + Vite
│   ├── src/
│   │   ├── screens/
│   │   │   ├── InputScreen.tsx
│   │   │   ├── ReviewScreen.tsx
│   │   │   └── ExecutionScreen.tsx
│   │   └── App.tsx
│   └── vite.config.ts          # proxy /api/* → localhost:3001
└── prompts/
    └── plan_system.md          # LLM system prompt (load at runtime, not hardcoded)
```

---

## Core Types — Define These First, Lock Them Early

```rust
// sentinel-core/src/action.rs

#[derive(Serialize, Deserialize, Debug, Clone, JsonSchema)]
#[serde(tag = "type")]
pub enum Action {
    DeleteFile {
        path: PathBuf,
        reason: String,
    },
    DeleteFilesMatching {
        root: PathBuf,
        older_than_days: Option<u32>,
        pattern: Option<String>,        // glob, e.g. "*.log"
        reason: String,
    },
    MoveFile {
        from: PathBuf,
        to: PathBuf,
        reason: String,
    },
    MoveFilesMatching {
        root: PathBuf,
        destination: PathBuf,
        pattern: Option<String>,
        older_than_days: Option<u32>,
        reason: String,
    },
    ChangePermissions {
        path: PathBuf,
        mode: PermissionSpec,
        recursive: bool,
        reason: String,
    },
    KillProcess {
        pid_or_name: ProcessTarget,
        signal: KillSignal,             // Terminate | Kill | Interrupt
        reason: String,
    },
    CompressDirectory {
        path: PathBuf,
        output: PathBuf,
        delete_source: bool,
        reason: String,
    },
    FindLargeFiles {
        root: PathBuf,
        min_size_mb: u64,
    },
    EmptyTrash,
    ListRunningProcesses {
        filter: Option<String>,
    },
    // NOT HERE: RunShellCommand(String) — never let the model emit raw shell
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ActionPlan {
    pub id: Uuid,
    pub original_request: String,
    pub actions: Vec<Action>,
    pub estimated_impact: ImpactSummary,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImpactSummary {
    pub file_count: Option<u64>,
    pub total_size_mb: Option<f64>,
    pub reversible: bool,               // true only if ALL actions are reversible
    pub notes: String,                  // human-readable, e.g. "oldest file from 2019"
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type")]
pub enum LlmResponse {
    Plan(ActionPlan),
    NeedsClarification { question: String },
    CannotDo { reason: String },
}

pub enum PolicyDecision {
    Allow,
    Deny(String),
    RequireExtraConfirmation(String),
}
```

---

## Policy Engine — sentinel-policy/src/lib.rs

Pure Rust, no async, no IO. Takes an `Action`, returns `PolicyDecision`.

**Required rules to implement:**
1. Deny any path that contains `..` (path traversal)
2. Deny any path outside `$HOME` (configurable root allowlist)
3. Deny deleting any path with fewer than 3 path components (e.g. `/home`, `/usr`)
4. Deny `KillProcess` where PID < 100 (system processes)
5. `RequireExtraConfirmation` for `delete_source: true` on CompressDirectory
6. `RequireExtraConfirmation` for `DeleteFilesMatching` when `older_than_days` is None (no age filter — would delete everything)
7. Blast-radius cap: `RequireExtraConfirmation` if estimated file count > 50 or total_size_mb > 500

**Write 20+ unit tests for the policy engine.** Include:
- A test that tries to delete `/etc/passwd` → must be Denied
- A test with `../../../etc` path → must be Denied
- A test deleting 51 files → must be RequireExtraConfirmation
- Normal Downloads cleanup → must be Allow

---

## Execution Engine — sentinel-exec/src/lib.rs

```rust
pub trait PrivilegedExecutor: Send + Sync {
    fn execute_action(&self, action: &Action) -> Result<ActionResult, ExecError>;
    fn dry_run_action(&self, action: &Action) -> Result<DryRunResult, ExecError>;
    fn elevate(&self) -> Result<ElevationToken, ExecError>;
}

// Implement first — used in all development and testing
pub struct DryRunExecutor;

// Implement for your dev OS next
#[cfg(target_os = "linux")]
pub struct LinuxExecutor;

#[cfg(target_os = "windows")]
pub struct WindowsExecutor;

// Stub until later
#[cfg(target_os = "macos")]
pub struct MacOsExecutor;
```

**Soft-delete pattern for DeleteFile:** instead of `fs::remove_file`, move to `~/.sentinel-trash/{timestamp}_{filename}`. Write a companion cleanup job that hard-deletes trash older than 7 days. This gives undo for free and is a real safety pattern worth documenting.

---

## Audit Log Schema (SQLite)

```sql
CREATE TABLE audit_plans (
    id          TEXT PRIMARY KEY,
    request     TEXT NOT NULL,
    plan_json   TEXT NOT NULL,          -- full ActionPlan as JSON
    status      TEXT NOT NULL,          -- Pending | Approved | Rejected | Executed | Failed
    created_at  TEXT NOT NULL,
    approved_at TEXT,
    executed_at TEXT
);

CREATE TABLE audit_actions (
    id          TEXT PRIMARY KEY,
    plan_id     TEXT NOT NULL REFERENCES audit_plans(id),
    action_type TEXT NOT NULL,
    action_json TEXT NOT NULL,
    policy      TEXT NOT NULL,          -- Allow | Deny | RequireExtra
    result      TEXT,                   -- Success | Failed | Skipped
    error       TEXT,
    executed_at TEXT
);

-- Append-only enforcement
CREATE TRIGGER no_update_plans BEFORE UPDATE ON audit_plans BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER no_delete_plans BEFORE DELETE ON audit_plans BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
```

---

## Axum API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/plan` | Body: `{ request: string, dry_run: bool }` → returns `LlmResponse` |
| POST | `/api/plan/:id/approve` | Moves plan to Approved state |
| POST | `/api/plan/:id/execute` | Executes approved plan, streams progress |
| GET | `/api/plan/:id` | Get plan + policy decisions |
| GET | `/api/audit` | List past plans (paginated) |
| WS | `/ws/plan/:id` | Streams `ActionEvent` messages during execution |

**WebSocket event shape:**
```json
{ "type": "ActionStarted", "action_index": 0, "action_type": "DeleteFilesMatching" }
{ "type": "ActionCompleted", "action_index": 0, "files_affected": 12, "bytes_freed": 340000000 }
{ "type": "ActionFailed", "action_index": 0, "error": "Permission denied: /Downloads/locked.dmg" }
{ "type": "PlanCompleted", "total_actions": 3, "succeeded": 3, "failed": 0 }
```

---

## LLM System Prompt (prompts/plan_system.md)

Load this file at runtime — do NOT hardcode it in source.

```
You are Sentinel's planning engine. You translate natural language requests into a structured action plan for a system automation tool.

You ONLY return one of three response types:
1. A valid ActionPlan JSON (when the request is clear and actionable)
2. A NeedsClarification JSON (when the request is too vague to act safely)
3. A CannotDo JSON (when the request falls outside the supported action types)

Rules:
- Every action MUST include a "reason" field explaining why this action fulfills the user's intent.
- You MUST estimate impact in the ImpactSummary: approximate file count, total size in MB, and whether all actions are reversible.
- If a request is ambiguous (e.g. "clean up my downloads" with no criteria), ask ONE clarifying question.
- NEVER emit a RunShellCommand action. If the request cannot be satisfied with the available action types, return CannotDo.
- Paths must be absolute. Expand ~ to the user's home directory.
- Prefer conservative interpretations: if unsure between deleting and moving, prefer moving.

Available action types and their JSON schemas are provided as tool definitions.
```

---

## Frontend — Three Screens

**Screen 1: Input**
- Large textarea, submit button, dry-run toggle in header
- On submit: POST /api/plan, show spinner

**Screen 2: Plan Review**
For each action, show:
- Action type badge (colored by risk: green=low, yellow=medium, red=high)
- Target path / process name
- LLM's reason (quoted)
- Policy decision chip: ✓ Allowed / ✗ Denied / ⚠ Needs Confirmation
- Reversible / Irreversible tag

Bottom: ImpactSummary banner ("12 files · 340 MB · ⚠ Irreversible"), big Approve button, Cancel button.
Denied actions are shown but greyed out — they will be skipped.

**Screen 3: Live Execution**
- Each action as a row: pending (grey) → running (pulsing) → ✓ done (green) / ✗ failed (red)
- Final summary card
- "View in Audit Log" link

---

## Build Order

1. Define all types in `sentinel-core`. Add `schemars` derive. Generate JSON schema with `schema_for!(ActionPlan)` — this becomes your LLM tool definition. Do this BEFORE touching the LLM.
2. Implement policy engine. Write all unit tests. Get to 100% variant coverage.
3. Implement `DryRunExecutor`. Wire it up with a CLI binary: `cargo run --bin sentinel-cli -- "your request"`. Full pipeline working before any real execution.
4. Add Axum server. Test all endpoints with curl.
5. Implement real execution for your dev OS (3 action types to start: DeleteFilesMatching, MoveFile, KillProcess).
6. Build React frontend against hardcoded mock JSON first, then swap for real API.
7. Add WebSocket streaming.
8. Demo polish: script two scenarios (happy path + blocked dangerous request), write README.

---

## Key Constraints / Non-Goals

- No arbitrary shell execution — ever. This is a design choice, not a gap.
- Single user, single machine scope for v1.
- No cloud — everything runs and stores locally.
- No STT/voice in v1 (easy to add later as an input adapter).
- macOS backend is documented but stubbed — explicitly state this in README.
