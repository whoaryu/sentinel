import React, { useState } from 'react';
import { ShieldCheck, ShieldAlert, AlertTriangle, ArrowRight, CornerDownLeft, Undo2, CheckCircle2, XCircle } from 'lucide-react';
import { EvaluatedPlan, EvaluatedAction } from '../types/sentinel';

interface ReviewScreenProps {
  evaluation: EvaluatedPlan;
  dryRun: boolean;
  setDryRun: (d: boolean) => void;
  onApprove: () => void;
  onCancel: () => void;
}

export const ReviewScreen: React.FC<ReviewScreenProps> = ({
  evaluation,
  dryRun,
  setDryRun,
  onApprove,
  onCancel,
}) => {
  const { plan, evaluated_actions, overall_decision } = evaluation;
  const [acknowledgedRisk, setAcknowledgedRisk] = useState(false);

  const hasDenied = evaluated_actions.some((ea) => ea.decision.status === 'Deny');
  const needsConfirmation =
    overall_decision.status === 'RequireExtraConfirmation' ||
    evaluated_actions.some((ea) => ea.decision.status === 'RequireExtraConfirmation');

  const canApprove =
    (!hasDenied || evaluated_actions.some((ea) => ea.decision.status === 'Allow')) &&
    (!needsConfirmation || acknowledgedRisk);

  const renderActionTarget = (action: any) => {
    switch (action.type) {
      case 'DeleteFile':
        return action.path;
      case 'DeleteFilesMatching':
        return `${action.root} (matching '${action.pattern || '*'}'${action.older_than_days ? `, >${action.older_than_days}d` : ''})`;
      case 'MoveFile':
        return `${action.from} → ${action.to}`;
      case 'MoveFilesMatching':
        return `${action.root} → ${action.destination} (matching '${action.pattern || '*'}')`;
      case 'KillProcess':
        return `Target: ${action.pid_or_name} (Signal: ${action.signal})`;
      case 'CompressDirectory':
        return `${action.path} → ${action.output} (delete_source: ${action.delete_source ? 'true' : 'false'})`;
      case 'FindLargeFiles':
        return `Scan ${action.root} (>= ${action.min_size_mb} MB)`;
      case 'EmptyTrash':
        return `Sentinel Trash Directory (~/.sentinel-trash/)`;
      case 'ListRunningProcesses':
        return `List system processes (filter: ${action.filter || 'all'})`;
      default:
        return 'Target OS Resource';
    }
  };

  return (
    <div className="view-container">
      {/* View Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            style={{ padding: '4px 10px', fontSize: 12 }}
          >
            ← Back to Input
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="badge-tag">
              Plan ID: {plan.id.slice(0, 8)}
            </span>
            <span className="badge-tag badge-accent">
              Original: &ldquo;{plan.original_request}&rdquo;
            </span>
          </div>
        </div>

        <h1>Policy Review & Verification</h1>
        <p className="lead">
          Every proposed action must clear Sentinel&apos;s pure Rust policy engine before any privileged token is dispatched. Inspect the security decisions and blast-radius impact below.
        </p>
      </div>

      {/* Aggregate Impact Summary Banner */}
      <div className="impact-banner">
        <div className="impact-metrics">
          <div className="metric-col">
            <span className="metric-col-label">Files Affected</span>
            <span className="metric-col-val">
              {plan.estimated_impact.file_count ?? '0'}
            </span>
          </div>

          <div className="metric-col">
            <span className="metric-col-label">Disk Delta</span>
            <span className="metric-col-val">
              {plan.estimated_impact.total_size_mb ? `${plan.estimated_impact.total_size_mb.toFixed(1)} MB` : '0 MB'}
            </span>
          </div>

          <div className="metric-col">
            <span className="metric-col-label">Reversibility</span>
            <span className="metric-col-val" style={{ color: plan.estimated_impact.reversible ? 'var(--safe-contrast)' : 'var(--warn-contrast)' }}>
              {plan.estimated_impact.reversible ? '100% Reversible' : 'Soft-Delete Staging'}
            </span>
          </div>

          <div className="metric-col">
            <span className="metric-col-label">Overall Policy Verdict</span>
            <span className="metric-col-val" style={{ color: hasDenied ? 'var(--danger-contrast)' : needsConfirmation ? 'var(--warn-contrast)' : 'var(--safe-contrast)' }}>
              {hasDenied ? 'Contains Violations' : needsConfirmation ? 'Requires Override' : 'Policy Cleared'}
            </span>
          </div>
        </div>

        <div>
          <button
            type="button"
            className={`badge-tag ${dryRun ? 'badge-safe' : 'badge-warn'}`}
            onClick={() => setDryRun(!dryRun)}
            style={{ cursor: 'pointer', padding: '6px 12px' }}
          >
            {dryRun ? 'Mode: Simulation Active' : 'Mode: Live Execution'}
          </button>
        </div>
      </div>

      {/* Structured Actions Review List */}
      <div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12, fontFamily: 'var(--font-mono)' }}>
          Proposed Action Items ({evaluated_actions.length})
        </div>

        <div className="actions-list">
          {evaluated_actions.map((ea: EvaluatedAction, idx: number) => {
            const isDeny = ea.decision.status === 'Deny';
            const isConfirm = ea.decision.status === 'RequireExtraConfirmation';

            return (
              <div
                key={idx}
                className={`action-card ${isDeny ? 'denied' : isConfirm ? 'flagged' : ''}`}
              >
                <div className="action-card-header">
                  <div className="action-type-label">
                    <span style={{ color: 'var(--fg-muted)' }}>#{String(idx + 1).padStart(2, '0')}</span>
                    <span>{ea.action.type}</span>
                    <span className="badge-tag" style={{ fontSize: 10 }}>
                      Risk: {ea.risk_level}
                    </span>
                  </div>

                  <div>
                    {isDeny ? (
                      <span className="badge-tag badge-danger">
                        <XCircle size={11} /> Denied by Policy
                      </span>
                    ) : isConfirm ? (
                      <span className="badge-tag badge-warn">
                        <AlertTriangle size={11} /> Confirmation Required
                      </span>
                    ) : (
                      <span className="badge-tag badge-safe">
                        <CheckCircle2 size={11} /> Policy Allowed
                      </span>
                    )}
                  </div>
                </div>

                {/* Target Path Box */}
                <div className="action-path-box">
                  {renderActionTarget(ea.action)}
                </div>

                {/* AI Rationale */}
                {(ea.action as any).reason && (
                  <div className="action-rationale">
                    &ldquo;{(ea.action as any).reason}&rdquo;
                  </div>
                )}

                {/* Policy Verdict Detail Row */}
                <div className="policy-verdict-row">
                  <span style={{ color: isDeny ? 'var(--danger-contrast)' : isConfirm ? 'var(--warn-contrast)' : 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                    {isDeny
                      ? `Policy rejection: ${ea.decision.reason}`
                      : isConfirm
                      ? `Security caution: ${ea.decision.reason}`
                      : 'Verified: Within designated user sandbox roots'}
                  </span>

                  <span className="badge-tag badge-muted" style={{ fontSize: 10.5 }}>
                    {ea.reversible ? 'Reversible move' : '7-day trash retention window'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Confirmation & Bottom Action Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 10, borderTop: '1px solid var(--border-hairline)' }}>
        {needsConfirmation && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--warn-subtle)',
              border: '1px solid var(--warn-border)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            <input
              type="checkbox"
              checked={acknowledgedRisk}
              onChange={(e) => setAcknowledgedRisk(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--warn)' }}
            />
            <span style={{ color: 'var(--warn-contrast)', fontWeight: 500 }}>
              I acknowledge the high-impact or unbounded criteria for this plan and explicitly authorize execution.
            </span>
          </label>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
          >
            Cancel Plan
          </button>

          <button
            type="button"
            className={hasDenied ? 'btn-danger' : 'btn-primary'}
            disabled={!canApprove}
            onClick={onApprove}
            style={{ minWidth: 180 }}
          >
            <span>{dryRun ? 'Approve & Run Simulation' : 'Approve & Execute (Elevated)'}</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
