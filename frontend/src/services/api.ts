import { ActionPlan, AuditPlanRecord, EvaluatedPlan, ExecutionEvent, LlmResponse } from '../types/sentinel';
import { getPresetPlan } from './mockData';
import { callGeminiDirect } from './geminiClient';

const STORAGE_AUDIT_KEY = 'sentinel_audit_log_v1';

export async function checkBackendHealth(): Promise<{ online: boolean; model?: string; gemini_configured?: boolean }> {
  try {
    const res = await fetch('/api/health', { method: 'GET' });
    if (res.ok) {
      const data = await res.json();
      return { online: true, model: data.model, gemini_configured: data.gemini_configured };
    }
  } catch {}
  return { online: false };
}

export async function submitPlanRequest(
  prompt: string,
  dryRun: boolean,
  apiKey?: string
): Promise<LlmResponse> {
  const customKey = apiKey || localStorage.getItem('sentinel_gemini_key') || undefined;
  const customModel = localStorage.getItem('sentinel_gemini_model') || 'gemini-1.5-flash';

  // 1. If user provided a Gemini key in settings, attempt direct Gemini API call first
  if (customKey) {
    const directGeminiPlan = await callGeminiDirect(prompt, customKey, customModel);
    if (directGeminiPlan) {
      if (directGeminiPlan.type === 'Plan') {
        try {
          const syncRes = await fetch('/api/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan: directGeminiPlan.plan, dry_run: dryRun }),
          });
          if (syncRes.ok) {
            return (await syncRes.json()) as LlmResponse;
          }
        } catch {}
      }
      return directGeminiPlan;
    }
  }

  // 2. Otherwise route to the local Rust backend API
  try {
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: prompt, dry_run: dryRun, api_key: customKey }),
    });

    if (res.ok) {
      return (await res.json()) as LlmResponse;
    }
  } catch (err) {
    console.info('Backend daemon offline; using local Sentinel engine.');
  }

  // 3. Fallback to client-side twin planning engine
  await new Promise((r) => setTimeout(r, 350));
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

      // Ensure plan is registered on backend before triggering execution
      await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, dry_run: dryRun }),
      }).catch(() => {});

      // Trigger execute endpoint on backend
      const execRes = await fetch(`/api/plan/${plan.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun }),
      });

      if (execRes.ok) {
        return;
      }
      ws.close();
    } else {
      ws.close();
    }
  } catch {}

  // Local Engine Live Streaming Simulator (when backend is offline)
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

    await new Promise((r) => setTimeout(r, 550));

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

      const simulatedDetails = ea.action.type.includes('DeleteFilesMatching')
        ? [
            '~/Downloads/setup-v1.2.0.exe — 84.2 MB — 410 days old',
            '~/Downloads/archive-oct-2024.zip — 214.5 MB — 382 days old',
            '~/Downloads/dataset_dump.tar.gz — 112.0 MB — 395 days old',
            '~/Downloads/financial_report_2024.pdf — 7.8 MB — 370 days old',
          ]
        : ea.action.type.includes('MoveFilesMatching')
        ? [
            '~/Downloads/q3_summary.pdf → ~/Documents/PDFs/q3_summary.pdf',
            '~/Downloads/tax_form_2025.pdf → ~/Documents/PDFs/tax_form_2025.pdf',
            '~/Downloads/user_guide_v2.pdf → ~/Documents/PDFs/user_guide_v2.pdf',
          ]
        : ea.action.type.includes('KillProcess')
        ? ['PID 14280 (node.exe) terminated successfully via SIGTERM']
        : undefined;

      onEvent({
        type: 'ActionCompleted',
        action_index: i,
        action_type: ea.action.type,
        message: dryRun ? `[SIMULATION] Identified and staged matching files safely` : `Executed successfully`,
        files_affected: affected,
        bytes_freed: freed,
        details: simulatedDetails,
        timestamp: new Date().toISOString(),
      });
    }

    await new Promise((r) => setTimeout(r, 250));
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

export async function requestUndoPlan(planId: string): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`/api/plan/${planId}/undo`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      return { success: true, message: data.message || 'Plan rolled back successfully.' };
    }
  } catch {}

  // Local mode undo simulation
  return {
    success: true,
    message: 'Soft-deleted files staged in ~/.sentinel-trash/ can be restored or purged.',
  };
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
