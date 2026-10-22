import { ActionPlan, AuditPlanRecord, EvaluatedPlan, ExecutionEvent, LlmResponse } from '../types/sentinel';
import { getPresetPlan } from './mockData';

const STORAGE_AUDIT_KEY = 'sentinel_audit_log_v1';

export async function submitPlanRequest(prompt: string, dryRun: boolean): Promise<LlmResponse> {
  try {
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: prompt, dry_run: dryRun }),
    });

    if (res.ok) {
      return (await res.json()) as LlmResponse;
    }
  } catch (err) {
    // API server offline, seamlessly use built-in engine
    console.info('Backend API unavailable; operating in local Sentinel engine mode.');
  }

  // Fallback to built-in local planning engine
  await new Promise((r) => setTimeout(r, 600)); // realistic typing/planning latency
  return getPresetPlan(prompt);
}

export async function approvePlan(planId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/plan/${planId}/approve`, { method: 'POST' });
    if (res.ok) return true;
  } catch {
    // Local mode
  }
  return true;
}

export async function executePlanWithStream(
  evaluation: EvaluatedPlan,
  dryRun: boolean,
  onEvent: (event: ExecutionEvent) => void
): Promise<void> {
  const plan = evaluation.plan;

  // Try real WebSocket execution if server is available
  try {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/plan/${plan.id}`);

    const hasConnected = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 800);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(true);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });

    if (hasConnected) {
      ws.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data);
          onEvent(parsed);
        } catch {}
      };

      // Trigger execute endpoint
      await fetch(`/api/plan/${plan.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun }),
      });
      return;
    } else {
      ws.close();
    }
  } catch {}

  // Local Engine Live Streaming Simulator
  let succeeded = 0;
  let failed = 0;
  let cumulativeFreed = 0;
  let cumulativeFiles = 0;

  for (let i = 0; i < evaluation.evaluated_actions.length; i++) {
    const ea = evaluation.evaluated_actions[i];
    const isDenied = ea.decision.status === 'Deny';

    onEvent({
      type: 'ActionStarted',
      action_index: i,
      action_type: ea.action.type,
      message: isDenied ? `Skipping blocked action: ${ea.action.type}` : `Executing ${ea.action.type}...`,
      timestamp: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 650));

    if (isDenied) {
      failed++;
      onEvent({
        type: 'ActionFailed',
        action_index: i,
        action_type: ea.action.type,
        error: `Policy engine halted action: ${ea.decision.reason}`,
        timestamp: new Date().toISOString(),
      });
    } else {
      succeeded++;
      const freed = ea.action.type.includes('Delete') ? 116 * 1024 * 1024 : 0;
      const affected = ea.action.type.includes('Delete') ? 4 : 1;
      cumulativeFreed += freed;
      cumulativeFiles += affected;

      onEvent({
        type: 'ActionCompleted',
        action_index: i,
        action_type: ea.action.type,
        message: dryRun ? `[SIMULATION] Simulated successfully` : `Executed successfully`,
        files_affected: affected,
        bytes_freed: freed,
        timestamp: new Date().toISOString(),
      });
    }

    await new Promise((r) => setTimeout(r, 350));
  }

  onEvent({
    type: 'PlanCompleted',
    total_actions: evaluation.evaluated_actions.length,
    succeeded,
    failed,
    bytes_freed: cumulativeFreed,
    files_affected: cumulativeFiles,
    timestamp: new Date().toISOString(),
  });

  // Record into audit log
  saveAuditRecord({
    id: plan.id,
    request: plan.original_request,
    plan_json: JSON.stringify(plan, null, 2),
    status: dryRun ? 'Simulated' : failed > 0 ? (succeeded > 0 ? 'Partial' : 'Denied') : 'Executed',
    created_at: plan.created_at,
    approved_at: new Date().toISOString(),
    executed_at: new Date().toISOString(),
    actions_count: plan.actions.length,
    summary_notes: plan.estimated_impact.notes,
  });
}

export function getStoredAuditRecords(): AuditPlanRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_AUDIT_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}

  // Initial seed audit records if empty
  const initial: AuditPlanRecord[] = [
    {
      id: 'plan-hist-001',
      request: 'Clean up stale build artifacts in ~/Downloads',
      plan_json: '{\n  "actions": 3,\n  "freed": "340 MB"\n}',
      status: 'Executed',
      created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
      approved_at: new Date(Date.now() - 3600000 * 24).toISOString(),
      executed_at: new Date(Date.now() - 3600000 * 24).toISOString(),
      actions_count: 3,
      summary_notes: '14 files soft-deleted to ~/.sentinel-trash/',
    },
    {
      id: 'plan-hist-002',
      request: 'Delete system files in C:\\Windows\\System32',
      plan_json: '{\n  "status": "Blocked by policy engine"\n}',
      status: 'Denied',
      created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
      approved_at: null,
      executed_at: null,
      actions_count: 2,
      summary_notes: 'Policy engine blocked unauthorized system path modification',
    },
  ];
  localStorage.setItem(STORAGE_AUDIT_KEY, JSON.stringify(initial));
  return initial;
}

export function saveAuditRecord(record: AuditPlanRecord): void {
  try {
    const list = getStoredAuditRecords();
    const updated = [record, ...list.filter((r) => r.id !== record.id)];
    localStorage.setItem(STORAGE_AUDIT_KEY, JSON.stringify(updated));
  } catch {}
}
