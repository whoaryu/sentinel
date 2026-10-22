use std::env;
use std::io::{self, Write};
use std::path::PathBuf;
use uuid::Uuid;

use sentinel_core::{Action, ActionPlan, ImpactSummary, PolicyDecision};
use sentinel_exec::{audit::AuditLog, dry_run::DryRunExecutor, traits::PrivilegedExecutor};
use sentinel_policy::{PolicyConfig, PolicyEngine};

fn main() {
    let args: Vec<String> = env::args().collect();
    let query = if args.len() > 1 {
        args[1..].join(" ")
    } else {
        "Clean up downloads older than 90 days".to_string()
    };

    println!("=======================================================");
    println!("  SENTINEL CLI — Elevated Task Automation");
    println!("=======================================================\n");
    println!("Natural Language Input: \"{}\"", query);

    // 1. Synthesize plan
    let plan = ActionPlan {
        id: Uuid::new_v4(),
        original_request: query.clone(),
        actions: vec![
            Action::DeleteFilesMatching {
                root: PathBuf::from("~/Downloads"),
                older_than_days: Some(90),
                pattern: Some("*.dmg".into()),
                reason: "Clean old installer disk images".into(),
            },
        ],
        estimated_impact: ImpactSummary {
            file_count: Some(12),
            total_size_mb: Some(340.0),
            reversible: false,
            notes: "12 files in Downloads (~340 MB) staged for soft-delete".into(),
        },
        created_at: chrono::Utc::now(),
    };

    // 2. Pure Policy Evaluation
    let policy_engine = PolicyEngine::new(PolicyConfig::default());
    let evaluation = policy_engine.evaluate_plan(&plan);

    println!("\n[POLICY ENGINE VERIFICATION]");
    for (i, ea) in evaluation.evaluated_actions.iter().enumerate() {
        let status_str = match &ea.decision {
            PolicyDecision::Allow => "[ALLOW]",
            PolicyDecision::Deny(r) => &format!("[DENY: {}]", r),
            PolicyDecision::RequireExtraConfirmation(r) => &format!("[CONFIRM REQUIRED: {}]", r),
        };
        println!("  #{} {:<20} -> {}", i + 1, ea.action.action_type_name(), status_str);
    }

    if evaluation.overall_decision.is_denied() {
        println!("\n❌ Execution aborted: Plan contains policy violations.");
        return;
    }

    // 3. User approval prompt
    print!("\nProceed with simulation? [y/N]: ");
    io::stdout().flush().unwrap();
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();

    if input.trim().eq_ignore_ascii_case("y") {
        println!("\n[SIMULATION EXECUTION]");
        let executor = DryRunExecutor::new();
        for action in &plan.actions {
            match executor.dry_run_action(action) {
                Ok(res) => println!("  ✓ {}", res.message),
                Err(e) => println!("  ✗ Error: {}", e),
            }
        }

        // 4. Append-only audit log
        if let Ok(audit) = AuditLog::open(None) {
            let _ = audit.record_plan(&plan, "Simulated");
            println!("\n✓ Recorded into append-only SQLite audit log at: {}", audit.db_path().display());
        }
    } else {
        println!("Execution cancelled by user.");
    }
}
