# Sentinel — Project Completion Roadmap & Task Checklist

---

## 📌 Status Summary
- **Policy Engine**: ✅ **100% Complete** (All 22 unit tests passing, zero I/O, strict safety boundary).
- **Core Types & Schema**: ✅ **100% Complete** (Closed `Action` enum, `ActionPlan`, `schemars` JSON schema generation).
- **SQLite Audit Trail**: ✅ **100% Complete** (Append-only database triggers preventing UPDATE & DELETE).
- **Windows Executor**: ✅ **95% Complete** (Soft-delete trash staging, 7-day purge, move, kill, compress, dry-run).
- **Google Gemini Integration**: ✅ **100% Complete** (Native Google Generative Language Client calling `gemini-2.5-flash`, JSON schema enforcement, key configuration).
- **Live WebSocket Streaming**: ✅ **100% Complete** (Axum `tokio::sync::broadcast` channel delivering real-time execution events).
- **One-Click Undo API**: ✅ **100% Complete** (`/api/plan/:id/undo` endpoint and frontend rollback button).
- **React 19 Frontend**: ✅ **100% Complete** (Ultra-polished Gemini aurora theme, settings drawer, live health indicator, safety meter).
- **Linux/macOS Backends**: 📋 **Planned** (Linux `pkexec`/`nix` backend; macOS documented and stubbed).

---

## ✅ Phase 1: Real Google Gemini Planning Engine Integration (`sentinel-api`)

- [x] **Task 1.1: Add HTTP & LLM dependencies to `sentinel-api/Cargo.toml`**
  - Added `reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }`
- [x] **Task 1.2: Implement Google Gemini Planner (`crates/sentinel-api/src/gemini.rs`)**
  - Reads `GEMINI_API_KEY` or `GOOGLE_API_KEY` from environment or frontend settings.
  - Configurable model (defaults to `gemini-2.5-flash`).
  - Calls `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}`.
- [x] **Task 1.3: Enforce Structured Schema Outputs**
  - Passes `prompts/plan_system.md` as `systemInstruction`.
  - Sets `generationConfig.responseMimeType = "application/json"`.
  - Feeds `schema_for!(LlmResponse)` schema hint.
- [x] **Task 1.4: Parse All Response Variants**
  - Parses `LlmResponse::Plan(ActionPlan)`, `LlmResponse::NeedsClarification`, and `LlmResponse::CannotDo`.
- [x] **Task 1.5: Offline & Twin Fallback**
  - Gracefully falls back to heuristic generation if API key is omitted or network is offline.

---

## ✅ Phase 2: Live Execution & WebSocket Pipeline (`sentinel-api` & `sentinel-exec`)

- [x] **Task 2.1: Implement Plan State Transitions in SQLite**
  - `/api/plan/:id/approve` updates status in active cache and audit log.
- [x] **Task 2.2: Channel-Based WebSocket Execution Streaming**
  - Broadcast channel in `handle_ws_execution` delivering real `ActionStarted`, `ActionCompleted`, `ActionFailed`, and `PlanCompleted` events.
- [x] **Task 2.3: Wire `POST /api/plan/:id/execute` to `PrivilegedExecutor`**
  - Executes approved actions through `WindowsExecutor` (or `DryRunExecutor` if `dry_run: true`).
- [x] **Task 2.4: Record Individual Action Execution Results**
  - Inserts executed action records into `audit_actions` with success, failure, and freed byte metrics.
- [x] **Task 2.5: Implement Undo / Rollback Endpoint**
  - Added `POST /api/plan/:id/undo` and frontend rollback handler.

---

## 🎨 Phase 3: Frontend Polish & Gemini UX Studio (`frontend`)

- [x] **Task 3.1: Google Gemini Celestial Aurora Design System**
  - Refined palette in `index.css`: deep obsidian canvas, luminous Gemini aurora gradients, and glassmorphic cards.
- [x] **Task 3.2: Gemini Settings & API Key Drawer**
  - Added `SettingsModal.tsx` allowing users to configure their Gemini API key and switch between `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-1.5-flash`, and `gemini-1.5-pro`.
- [x] **Task 3.3: Live Backend Health & Connection Badge**
  - Live pulse indicator in `Header.tsx` showing connection to Rust API on port 3001 vs local client-side twin.
- [x] **Task 3.4: One-Click Undo Trigger**
  - Reversible actions render a rollback trigger on `ExecutionScreen.tsx`.

---

## 💻 Phase 4: Cross-Platform Execution Backends (`sentinel-exec`)

- [ ] **Task 4.1: Windows UAC Elevation Helper**
  - Replace stub `elevate()` in `windows.rs` with `ShellExecuteW "runas"` when elevation is explicitly required.
- [ ] **Task 4.2: Implement Linux Executor (`crates/sentinel-exec/src/linux.rs`)**
  - Implement `PrivilegedExecutor` using `nix` crate for POSIX file permissions, signals (`SIGTERM`, `SIGKILL`), and `pkexec` / Polkit elevation.
- [ ] **Task 4.3: Implement macOS Stub (`crates/sentinel-exec/src/macos.rs`)**
  - Document and stub Darwin authorization services.
