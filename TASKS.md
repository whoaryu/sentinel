# Sentinel — Project Completion Roadmap & Task Checklist

This checklist outlines the remaining implementation steps to take Sentinel from its current functional prototype to a full production-ready release.

---

## 📌 Status Summary
- **Policy Engine**: ✅ **100% Complete** (All 22 unit tests passing, zero I/O, strict safety boundary).
- **Core Types & Schema**: ✅ **100% Complete** (Closed `Action` enum, `ActionPlan`, `schemars` JSON schema generation).
- **SQLite Audit Trail**: ✅ **100% Complete** (Append-only database triggers preventing UPDATE & DELETE).
- **Windows Executor**: ✅ **90% Complete** (Soft-delete trash staging, 7-day purge, move, kill, compress, dry-run).
- **React Frontend**: ✅ **90% Complete** (4 full screens, dark mode, review safety meter, client-side mirror engine).
- **LLM Integration**: 🟡 **Pending** (Currently using canned synthesizer in API; needs Anthropic API tool-calling hook).
- **Live WebSocket Pipeline**: 🟡 **Pending** (Currently canned event sequence; needs real executor event bridge).
- **Linux/macOS Backends**: 📋 **Pending** (Linux `pkexec`/`nix` backend to write; macOS to document/stub).

---

## 🚀 Phase 1: Real LLM Planning Engine Integration (`sentinel-api`)

- [ ] **Task 1.1: Add HTTP & LLM dependencies to `sentinel-api/Cargo.toml`**
  - Add `reqwest = { version = "0.12", features = ["json", "rustls-tls"] }`
  - Ensure `schemars` and `serde_json` are wired for dynamic tool schema delivery.
- [ ] **Task 1.2: Implement Anthropic Claude tool-calling client**
  - Read `ANTHROPIC_API_KEY` from environment.
  - Load `prompts/plan_system.md` as the system prompt.
  - Provide `schema_for!(ActionPlan)` as the tool schema (`execute_plan`).
- [ ] **Task 1.3: Handle all 3 LLM response variants**
  - Parse tool calls into `LlmResponse::Plan(ActionPlan)`.
  - Handle clarifying queries into `LlmResponse::NeedsClarification { question }`.
  - Handle unsupported requests into `LlmResponse::CannotDo { reason }`.
- [ ] **Task 1.4: Graceful offline / dry-run fallback**
  - If `ANTHROPIC_API_KEY` is not present, fall back cleanly to template-based demonstration plans without crashing.

---

## ⚡ Phase 2: Live Execution & WebSocket Pipeline (`sentinel-api` & `sentinel-exec`)

- [ ] **Task 2.1: Implement Plan State Transitions in SQLite**
  - Connect `POST /api/plan/:id/approve` to update status to `"Approved"` in `audit_plans`.
- [ ] **Task 2.2: Channel-Based WebSocket Execution Streaming**
  - Replace the hardcoded `sleep` sequence in `handle_ws_execution` with a `tokio::sync::broadcast` channel.
  - Emit real-time `ActionStarted`, `ActionCompleted`, `ActionFailed`, and `PlanCompleted` events as actions execute.
- [ ] **Task 2.3: Wire `POST /api/plan/:id/execute` to `PrivilegedExecutor`**
  - Invoke `WindowsExecutor::execute_action` for each action in the approved plan.
  - Handle `dry_run: true` flag by delegating to `DryRunExecutor`.
- [ ] **Task 2.4: Record Individual Action Execution Results**
  - Insert rows into `audit_actions` with status (`Success`, `Failed`, `Skipped`), bytes freed, and timestamp.
- [ ] **Task 2.5: Implement Undo / Rollback Endpoint**
  - Create `POST /api/plan/:id/undo` to execute inverse actions (`undo_action` stored during execution).
  - Provide restore mechanism from `~/.sentinel-trash/`.

---

## 💻 Phase 3: Cross-Platform Execution Backends (`sentinel-exec`)

- [ ] **Task 3.1: Windows UAC Elevation Helper**
  - Replace stub `elevate()` in `windows.rs` with `ShellExecuteW "runas"` when elevation is explicitly required.
- [ ] **Task 3.2: Implement Linux Executor (`crates/sentinel-exec/src/linux.rs`)**
  - Implement `PrivilegedExecutor` using `nix` crate for POSIX file permissions, signals (`SIGTERM`, `SIGKILL`), and `pkexec` / Polkit elevation.
- [ ] **Task 3.3: Implement macOS Stub (`crates/sentinel-exec/src/macos.rs`)**
  - Add explicit `unimplemented!()` stubs with architecture documentation for Darwin authorization services (`AuthorizationExecuteWithPrivileges`).

---

## 🎨 Phase 4: Frontend Polish & End-to-End Verification (`frontend`)

- [ ] **Task 4.1: Live vs Offline Engine Connection Indicator**
  - Add a connection badge in `Header.tsx` indicating whether the UI is connected to the live Rust Axum backend (`http://localhost:3001`) or running in local offline demo mode.
- [ ] **Task 4.2: Undo / Restore UI Flow**
  - On `ExecutionScreen.tsx` and `AuditScreen.tsx`, render an "Undo Plan" button for successfully executed plans that have reversible actions.
- [ ] **Task 4.3: End-to-End WebSocket Testing**
  - Verify that live events from the backend update the progress bars, action chips, and metrics dynamically.

---

## 🛡️ Phase 5: Production Hardening, CI/CD & GitHub Setup

- [ ] **Task 5.1: Create GitHub Actions Workflow (`.github/workflows/ci.yml`)**
  - Add matrix build for Rust (`cargo check`, `cargo test --workspace`) and Node.js (`npm run build`).
- [ ] **Task 5.2: Add LICENSE files**
  - Add standard MIT and Apache 2.0 license texts to repository root.
- [ ] **Task 5.3: End-to-End Automated Script Run**
  - Run and verify `test-cases.ps1` and `test-cases.sh` against the running server.
