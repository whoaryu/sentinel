# Sentinel 🛡️
### Elevated OS Task Automation with Natural-Language Interface & Strict Rust Policy Boundaries

[![Rust](https://img.shields.io/badge/rust-2021%20edition-orange.svg?logo=rust)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/license-MIT%2FApache--2.0-blue.svg)](LICENSE)
[![Frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite%20%2B%20TypeScript-61dafb.svg?logo=react)](frontend)
[![Policy Engine](https://img.shields.io/badge/policy%20tests-22%20passing%20(100%25)-brightgreen.svg)](crates/sentinel-policy)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20(stub)%20%7C%20macOS%20(stub)-lightgrey.svg)]()

> **Core Principle:** An LLM only ever outputs structured, typed data (`ActionPlan`). It **never** touches the filesystem, spawns shell processes, or executes commands directly. All privileged OS operations must clear an independent, pure Rust policy engine and receive explicit human approval before execution.

---

## 📑 Table of Contents

- [The Problem with AI Agents](#-the-problem-with-ai-agents)
- [System Architecture & Safety Boundary](#-system-architecture--safety-boundary)
- [The Closed Action Enum](#-the-closed-action-enum)
- [Policy Engine Guarantees](#-policy-engine-guarantees)
- [Execution Engine & Soft-Delete Staging](#-execution-engine--soft-delete-staging)
- [Append-Only SQLite Audit Trail](#-append-only-sqlite-audit-trail)
- [Quick Start Guide](#-quick-start-guide)
  - [Prerequisites](#prerequisites)
  - [1. Running the React Frontend](#1-running-the-react-frontend)
  - [2. Running the Axum API Server](#2-running-the-axum-api-server)
  - [3. Running the Terminal CLI](#3-running-the-terminal-cli)
- [Interactive Demo Scenarios](#-interactive-demo-scenarios)
- [Workspace & Crate Structure](#-workspace--crate-structure)
- [Testing & Verification](#-testing--verification)
- [Implementation Status & Roadmap](#-implementation-status--roadmap)
- [Contributing & Security Policy](#-contributing--security-policy)

---

## 🚨 The Problem with AI Agents

Most AI terminal tools and coding agents grant language models direct access to raw shell execution (`bash -c "..."` or `cmd.exe /c "..."`). This introduces catastrophic security and reliability risks:
- **Prompt Injection & Jailbreaks**: A poisoned file name, markdown snippet, or prompt injection can trick an LLM into running destructive commands (`rm -rf /` or deleting registry hives).
- **Silent Hallucinations**: Syntax mistakes, wrong flags, or unescaped variables run with the user's full ambient privileges.
- **Unreviewable Scripts**: Dense multi-line bash or PowerShell scripts make manual user review tedious and error-prone.

**Sentinel eliminates this risk by architectural separation:**
```
Natural Language Request
          │
          ▼
┌─────────────────────────────────┐
│     LLM Planning Engine         │  <--- Isolated to structured output only
│  (Emits typed ActionPlan JSON)  │       NO filesystem, NO shell, NO network I/O
└─────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────┐
│    Pure Rust Policy Engine      │  <--- Deterministic validation (22 unit tests)
│  (Allow | Deny | ExtraConfirm)  │       Zero I/O, rejects path traversals & system targets
└─────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────┐
│     Human Review Screen         │  <--- High-fidelity impact & safety review
│  (Interactive diffs & badges)   │       User must approve before execution
└─────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────┐
│    Privileged Execution Engine  │  <--- Executes strictly verified operations
│  (Soft-delete staging + SQLite) │       Append-only audit trail with DB triggers
└─────────────────────────────────┘
```

---

## 🔒 The Closed Action Enum

Every operation supported by Sentinel is defined in a closed, strictly-typed enum in [`crates/sentinel-core/src/action.rs`](crates/sentinel-core/src/action.rs). There is deliberately **no** `RunShellCommand(String)` variant:

```rust
#[derive(Serialize, Deserialize, Debug, Clone, JsonSchema)]
#[serde(tag = "type")]
pub enum Action {
    DeleteFile { 
        path: PathBuf, 
        reason: String 
    },
    DeleteFilesMatching { 
        root: PathBuf, 
        older_than_days: Option<u32>, 
        pattern: Option<String>, 
        reason: String 
    },
    MoveFile { 
        from: PathBuf, 
        to: PathBuf, 
        reason: String 
    },
    MoveFilesMatching { 
        root: PathBuf, 
        destination: PathBuf, 
        pattern: Option<String>, 
        older_than_days: Option<u32>, 
        reason: String 
    },
    ChangePermissions { 
        path: PathBuf, 
        mode: PermissionSpec, 
        recursive: bool, 
        reason: String 
    },
    KillProcess { 
        pid_or_name: ProcessTarget, 
        signal: KillSignal, 
        reason: String 
    },
    CompressDirectory { 
        path: PathBuf, 
        output: PathBuf, 
        delete_source: bool, 
        reason: String 
    },
    FindLargeFiles { 
        root: PathBuf, 
        min_size_mb: u64 
    },
    EmptyTrash,
    ListRunningProcesses { 
        filter: Option<String> 
    },
}
```

### Why this design matters:
- **Exhaustive Matching**: The Rust compiler guarantees that every action variant is handled by both the policy engine and the executor. An action cannot exist without an explicit security policy.
- **Human-Readable Review**: The UI displays concrete actions (e.g. *"Soft-delete 14 files in ~/Downloads older than 90 days"*) rather than opaque shell commands.
- **Reversible Operations**: Actions calculate their inverse (`undo_action`), allowing one-click rollback.

---

## 🛡️ Policy Engine Guarantees

Implemented in [`crates/sentinel-policy/src/lib.rs`](crates/sentinel-policy/src/lib.rs) as pure synchronous Rust with zero I/O:

1. **Path Traversal Prevention**: Instantly denies any path containing `..`, parent escapes, or null bytes.
2. **System Root Protection**: Denies operations outside designated user roots (e.g., prevents touches to `/etc`, `/usr`, `C:\Windows`, `C:\Program Files`).
3. **Shallow Path Component Guard**: Refuses deletions targeting shallow root paths (requires $\ge 3$ path components).
4. **System Process Immunity**: Blocks killing system PIDs ($< 100$) and critical OS binaries (`csrss`, `lsass`, `system`, `services`, `init`).
5. **Unbounded Deletion Guard**: Actions without age criteria automatically trigger `RequireExtraConfirmation`.
6. **Blast-Radius Thresholds**: Plans modifying $> 50$ files or $> 500$ MB automatically enforce explicit secondary confirmation.

---

## 🗄️ Execution Engine & Soft-Delete Staging

Implemented behind the `PrivilegedExecutor` trait in [`crates/sentinel-exec/src/windows.rs`](crates/sentinel-exec/src/windows.rs):

- **Soft-Delete Staging**: Instead of irreversible `fs::remove_file`, items are staged in `~/.sentinel-trash/{timestamp}_{filename}` with a 7-day retention period.
- **Dry-Run Simulation**: `DryRunExecutor` models 100% of the plan in memory, computing affected file counts and disk impact before any write operation.
- **Privilege Elevation**: Keeps ambient privileges un-elevated until an approved batch requires OS escalation.

---

## 📜 Append-Only SQLite Audit Trail

All plans, decisions, and execution outcomes are recorded to a local SQLite database protected by strict SQL triggers:

```sql
CREATE TABLE audit_plans (
    id          TEXT PRIMARY KEY,
    request     TEXT NOT NULL,
    plan_json   TEXT NOT NULL,
    status      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    approved_at TEXT,
    executed_at TEXT
);

-- Immutable Append-Only Enforcement
CREATE TRIGGER no_update_plans BEFORE UPDATE ON audit_plans 
BEGIN 
    SELECT RAISE(ABORT, 'audit log is append-only: updates prohibited'); 
END;

CREATE TRIGGER no_delete_plans BEFORE DELETE ON audit_plans 
BEGIN 
    SELECT RAISE(ABORT, 'audit log is append-only: deletions prohibited'); 
END;
```

---

## 🚀 Quick Start Guide

### Prerequisites
- **Rust toolchain** (1.75+ recommended): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Node.js** (v18+ or v20+ recommended) & `npm`

---

### 1. Running the React Frontend

The frontend features a full-fidelity dark mode UI with interactive review cards, risk ratings, and a client-side twin engine for instant testing.

```bash
cd frontend
npm install
npm run dev
```
Open **[http://localhost:5173/](http://localhost:5173/)** in your browser.

---

### 2. Running the Axum API Server

The backend exposes REST and WebSocket endpoints for plan synthesis, policy evaluation, and event streaming.

```bash
# Set environment variable (recommended on Windows to prevent file locks)
# PowerShell:
$env:CARGO_INCREMENTAL = "0"
cargo run --bin sentinel-api

# Bash / Linux:
CARGO_INCREMENTAL=0 cargo run --bin sentinel-api
```
The server starts at `http://127.0.0.1:3001`. The frontend automatically proxies `/api/*` and `/ws/*` requests to this port.

---

### 3. Running the Terminal CLI

Sentinel also includes a standalone command-line runner for terminal workflows:

```bash
cargo run --bin sentinel-cli -- "Clean up downloads older than 90 days"
```

---

## 🧪 Interactive Demo Scenarios

Once the frontend is open, try these built-in test scenarios:

| Scenario | Input Query / Action | Expected Engine Behavior |
|---|---|---|
| **Happy Path Cleanup** | *"Clean old Downloads"* | Policy: `Allow`. Previews soft-deletion of `*.dmg` files older than 90 days. |
| **System Breach Attempt** | *"Delete Windows System32"* | Policy: `Deny`. Blocks traversal and path outside user root directory. |
| **Ambiguity Handling** | *"Clean up my downloads"* | Returns `NeedsClarification` asking for date criteria or subfolder organization. |
| **Blast-Radius Trigger** | *"High-Impact Archive"* | Policy: `RequireExtraConfirmation` because size exceeds 500 MB and deletes source. |

---

## 📂 Workspace & Crate Structure

```
sentinel/
├── Cargo.toml                  # Workspace root
├── .env.example                # Sample environment configuration
├── prompts/
│   └── plan_system.md          # Runtime LLM prompt (never hardcoded in binary)
├── crates/
│   ├── sentinel-core/          # Closed Action enum, ActionPlan, PolicyDecision schemas
│   ├── sentinel-policy/        # Pure Rust policy engine (22 unit tests, zero I/O)
│   ├── sentinel-exec/          # PrivilegedExecutor, Windows backend, SQLite audit log
│   ├── sentinel-api/           # Axum REST & WebSocket event streaming server
│   └── sentinel-cli/           # Standalone terminal verification runner
└── frontend/                   # Modern React 19 + TypeScript + Vite UI
    ├── src/
    │   ├── components/         # Header, Sidebar, Badges, Modals
    │   ├── engine/             # Client-side twin of Rust policy engine
    │   ├── screens/            # InputScreen, ReviewScreen, ExecutionScreen, AuditScreen
    │   └── services/           # REST API & WebSocket execution stream client
```

---

## 🔬 Testing & Verification

Sentinel emphasizes strict deterministic test coverage:

```bash
# Test the pure Policy Engine (22 safety boundary tests)
cargo test -p sentinel-policy

# Test Core Schema Generation
cargo test -p sentinel-core

# Test SQLite Audit Triggers & Append-Only Guarantees
cargo test -p sentinel-exec

# Verify Frontend TypeScript & Production Bundle
cd frontend
npm run build
```

---

## 🗺️ Implementation Status & Roadmap

| Component | Status | Details |
|---|---|---|
| **Closed Action Enum** | ✅ **Complete** | 10 exhaustive action types with `schemars` JSON schemas |
| **Rust Policy Engine** | ✅ **Complete** | 22 unit tests covering path safety, blast radius, protected targets |
| **SQLite Audit Log** | ✅ **Complete** | Append-only database triggers preventing DELETE and UPDATE |
| **Windows Execution Backend** | ✅ **Complete** | Soft-delete to `~/.sentinel-trash`, file move, process termination |
| **React 19 Frontend** | ✅ **Complete** | 4 full screens (Input, Review, Execution, Audit Log) + offline twin |
| **Live LLM Integration** | 🟡 **In Progress** | Wire Claude API structured tool-calling into `sentinel-api` |
| **Live WebSocket Execution** | 🟡 **In Progress** | Connect Axum WebSocket handler to live `WindowsExecutor` events |
| **Linux Backend (`nix`+`pkexec`)** | 📋 **Planned** | POSIX file permissions, signals, and Polkit elevation |
| **macOS Backend** | 📋 **Documented** | Stubbed for future Darwin integration |
| **One-Click Undo API** | 📋 **Planned** | Dedicated `/api/plan/:id/undo` endpoint restoring soft-deleted files |

---

## 🤝 Contributing & Security Policy

1. **Security Invariant**: Never add a variant to `Action` that accepts arbitrary command strings or shell expressions.
2. **Policy Invariant**: The policy engine in `sentinel-policy` must remain 100% synchronous and perform zero filesystem or network I/O.
3. **Execution Invariant**: Every deletion must route through the soft-delete staging directory (`~/.sentinel-trash`) unless explicitly purging the trash.

Pull requests and issues are welcome! Please run `cargo test --workspace` before submitting PRs.

---

## 📄 License

Licensed under either of:
- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)
at your option.
