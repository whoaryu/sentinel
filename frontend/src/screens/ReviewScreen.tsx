import React, { useState } from 'react';
import {
  ShieldAlert,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Play,
  RotateCcw,
  Layers,
  FileText,
  Sliders,
  ShieldCheck,
  Filter,
} from 'lucide-react';
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
  const [filterMode, setFilterMode] = useState<'all' | 'allowed' | 'flagged'>('all');

  const hasDenied = evaluated_actions.some((ea) => ea.decision.status === 'Deny');
  const needsConfirmation =
    overall_decision.status === 'RequireExtraConfirmation' ||
    evaluated_actions.some((ea) => ea.decision.status === 'RequireExtraConfirmation');

  // Compute a dynamic safety rating score (0 - 100)
  const safetyScore = hasDenied
    ? 15
    : needsConfirmation
    ? 68
    : 98;

  const filteredActions = evaluated_actions.filter((ea) => {
    if (filterMode === 'allowed') return ea.decision.status === 'Allow';
    if (filterMode === 'flagged') return ea.decision.status !== 'Allow';
    return true;
  });

  const canApprove = (!hasDenied || evaluated_actions.some((ea) => ea.decision.status === 'Allow')) &&
    (!needsConfirmation || acknowledgedRisk);

  return (
    <div className="view-container">
      {/* Top Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            style={{ fontSize: 13, padding: '6px 14px' }}
          >
            ← Back to Input Command
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="badge-tag badge-accent">
              <Layers size={13} /> Action Plan #{plan.id.slice(0, 8)}
            </span>
            <span className="badge-tag badge-muted">
              &ldquo;{plan.original_request}&rdquo;
            </span>
          </div>
        </div>
        <h1>Policy Review & Verification</h1>
        <p className="lead">
          Inspect the proposed operations below. Every single action must clear Sentinel&apos;s pure Rust policy engine before any elevation token is dispatched.
        </p>
      </div>

      {/* Safety Score Card */}
      <div className="safety-meter-card">
        <div>
          <span className="metric-label">Policy Safety Rating</span>
          <div className="safety-meter-score">
            <span
              className="score-number"
              style={{
                color: safetyScore > 80 ? 'var(--safe)' : safetyScore > 50 ? 'var(--warn)' : 'var(--danger)',
              }}
            >
              {safetyScore}
            </span>
            <span style={{ fontSize: 16, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>/100</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 4 }}>
            {safetyScore > 80
              ? 'Sandboxed within user profile. All safety invariants validated.'
              : safetyScore > 50
              ? 'Elevated blast-radius or missing age filter requires secondary authorization.'
              : 'CRITICAL: Blocked by policy engine. System directory or traversal attack detected.'}
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          {safetyScore > 80 && (
            <span className="badge-tag badge-safe" style={{ padding: '6px 14px' }}>
              <ShieldCheck size={14} /> Low Risk Profile
            </span>
          )}
          {safetyScore > 50 && safetyScore <= 80 && (
            <span className="badge-tag badge-warn" style={{ padding: '6px 14px' }}>
              <AlertTriangle size={14} /> High Blast Radius
            </span>
          )}
          {safetyScore <= 50 && (
            <span className="badge-tag badge-danger" style={{ padding: '6px 14px' }}>
              <ShieldAlert size={14} /> Policy Blocked
            </span>
          )}
        </div>
      </div>

      {/* Overall Policy Alert if Denied or Requires Extra Confirmation */}
      {overall_decision.status === 'Deny' && (
        <div className="card" style={{ background: 'var(--danger-dim)', borderColor: 'rgba(239, 68, 68, 0.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <XCircle size={20} color="var(--danger)" />
            <h3 style={{ color: 'var(--danger)' }}>Unauthorized Action Detected</h3>
          </div>
          <p style={{ color: 'var(--fg)', fontSize: 14.5 }}>
            {overall_decision.reason || 'One or more actions violate system boundaries or safety policies.'}
          </p>
          <div style={{ fontSize: 12.5, color: 'var(--fg-secondary)', marginTop: 8 }}>
            Denied actions will be skipped automatically during execution.
          </div>
        </div>
      )}

      {overall_decision.status === 'RequireExtraConfirmation' && (
        <div className="card" style={{ background: 'var(--warn-dim)', borderColor: 'rgba(245, 158, 11, 0.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <AlertTriangle size={20} color="var(--warn)" />
            <h3 style={{ color: 'var(--warn)' }}>Elevation Authorization Required</h3>
          </div>
          <p style={{ color: 'var(--fg)', fontSize: 14.5 }}>
            {overall_decision.reason}
          </p>
        </div>
      )}

      {/* Actions List with Filter Tabs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <h2>Proposed Action Pipeline ({evaluated_actions.length})</h2>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={`btn-secondary ${filterMode === 'all' ? 'badge-accent' : ''}`}
              style={{ fontSize: 12.5, padding: '5px 12px' }}
              onClick={() => setFilterMode('all')}
            >
              All ({evaluated_actions.length})
            </button>
            <button
              className={`btn-secondary ${filterMode === 'allowed' ? 'badge-safe' : ''}`}
              style={{ fontSize: 12.5, padding: '5px 12px' }}
              onClick={() => setFilterMode('allowed')}
            >
              Permitted ({evaluated_actions.filter((e) => e.decision.status === 'Allow').length})
            </button>
            <button
              className={`btn-secondary ${filterMode === 'flagged' ? 'badge-warn' : ''}`}
              style={{ fontSize: 12.5, padding: '5px 12px' }}
              onClick={() => setFilterMode('flagged')}
            >
              Flagged ({evaluated_actions.filter((e) => e.decision.status !== 'Allow').length})
            </button>
          </div>
        </div>

        {filteredActions.map((ea: EvaluatedAction, idx: number) => {
          const isBlocked = ea.decision.status === 'Deny';
          const isWarn = ea.decision.status === 'RequireExtraConfirmation';

          const riskBadge =
            ea.risk_level === 'Critical'
              ? 'badge-danger'
              : ea.risk_level === 'High'
              ? 'badge-warn'
              : ea.risk_level === 'Medium'
              ? 'badge-warn'
              : 'badge-safe';

          return (
            <div
              key={idx}
              className={`action-review-card ${isBlocked ? 'blocked' : ''} ${isWarn ? 'needs-confirm' : ''}`}
            >
              <div className="action-card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--fg-dim)', fontSize: 13 }}>
                    #{idx + 1}
                  </span>
                  <span className={`badge-tag ${riskBadge}`}>
                    {ea.action.type}
                  </span>
                  <span className={`badge-tag ${ea.reversible ? 'badge-info' : 'badge-muted'}`}>
                    {ea.reversible ? '✓ Reversible' : '✗ Irreversible'}
                  </span>
                </div>

                {/* Policy Decision Chip */}
                <div>
                  {ea.decision.status === 'Allow' && (
                    <span className="badge-tag badge-safe">
                      <CheckCircle size={13} /> Allowed
                    </span>
                  )}
                  {ea.decision.status === 'Deny' && (
                    <span className="badge-tag badge-danger">
                      <XCircle size={13} /> Denied by Policy
                    </span>
                  )}
                  {ea.decision.status === 'RequireExtraConfirmation' && (
                    <span className="badge-tag badge-warn">
                      <AlertTriangle size={13} /> Needs Confirmation
                    </span>
                  )}
                </div>
              </div>

              {/* Action Target Summary */}
              <div className="action-target-row">
                <FileText size={15} color="var(--accent)" />
                <span>{getActionTarget(ea.action)}</span>
              </div>

              {/* LLM Justification Quote */}
              {'reason' in ea.action && (
                <div className="action-reason-quote">
                  &ldquo;{(ea.action as any).reason}&rdquo;
                </div>
              )}

              {/* Policy Engine explanation if not Allow */}
              {ea.decision.reason && (
                <div
                  style={{
                    fontSize: 12.5,
                    fontFamily: 'var(--font-mono)',
                    color: isBlocked ? 'var(--danger-light)' : 'var(--warn-light)',
                    paddingTop: 2,
                  }}
                >
                  Policy Rule: {ea.decision.reason}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Impact Summary Banner */}
      <div
        className={`impact-banner ${
          hasDenied ? 'blocked' : !plan.estimated_impact.reversible ? 'irreversible' : ''
        }`}
      >
        <div className="impact-metrics">
          <div className="impact-metric-item">
            <span className="metric-label">Affected Files</span>
            <span className="metric-value">
              {plan.estimated_impact.file_count != null ? plan.estimated_impact.file_count : 'N/A'}
            </span>
          </div>

          <div className="impact-metric-item">
            <span className="metric-label">Estimated Size</span>
            <span className="metric-value">
              {plan.estimated_impact.total_size_mb != null
                ? `${plan.estimated_impact.total_size_mb.toFixed(1)} MB`
                : 'N/A'}
            </span>
          </div>

          <div className="impact-metric-item">
            <span className="metric-label">Safety Profile</span>
            <span className="metric-value" style={{ fontSize: 13.5 }}>
              {plan.estimated_impact.reversible ? '✓ 100% Reversible' : '⚠ Destruction / Soft-delete'}
            </span>
          </div>
        </div>

        <div style={{ fontSize: 13, color: 'var(--fg-muted)', maxWidth: 320 }}>
          {plan.estimated_impact.notes}
        </div>
      </div>

      {/* Confirmation Checkbox if high risk / blast radius */}
      {needsConfirmation && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            background: 'var(--bg-card)',
            padding: '16px 20px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={acknowledgedRisk}
            onChange={(e) => setAcknowledgedRisk(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
          />
          <span style={{ fontSize: 13.5, color: 'var(--fg)' }}>
            I acknowledge this plan modifies high-impact files or system processes, and authorize elevated execution.
          </span>
        </label>
      )}

      {/* Action Decision Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <button className="btn-secondary" onClick={onCancel}>
          <RotateCcw size={15} />
          <span>Cancel & Refine</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            className={`sim-switch ${dryRun ? 'active' : ''}`}
            onClick={() => setDryRun(!dryRun)}
            title="Toggle simulation mode"
          >
            <Sliders size={14} />
            <span>Dry-Run Simulation: {dryRun ? 'ON' : 'OFF'}</span>
          </button>

          <button
            className="btn-primary"
            disabled={!canApprove}
            onClick={onApprove}
            style={{
              background: dryRun ? 'var(--warn)' : undefined,
              boxShadow: dryRun ? '0 2px 14px var(--warn-glow)' : undefined,
            }}
          >
            <Play size={16} />
            <span>{dryRun ? 'Run Simulation' : 'Approve & Execute Plan'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

function getActionTarget(action: any): string {
  switch (action.type) {
    case 'DeleteFile':
      return action.path;
    case 'DeleteFilesMatching':
      return `${action.root} (${action.pattern || '*'}, >${action.older_than_days || '0'}d)`;
    case 'MoveFile':
      return `${action.from} → ${action.to}`;
    case 'MoveFilesMatching':
      return `${action.root}/${action.pattern || '*'} → ${action.destination}`;
    case 'ChangePermissions':
      return `${action.path} (mode: ${action.mode}, recursive: ${action.recursive})`;
    case 'KillProcess':
      return `Target: ${action.pid_or_name} (signal: ${action.signal})`;
    case 'CompressDirectory':
      return `${action.path} → ${action.output} (delete source: ${action.delete_source})`;
    case 'FindLargeFiles':
      return `${action.root} (>= ${action.min_size_mb} MB)`;
    case 'EmptyTrash':
      return 'Sentinel Trash (~/.sentinel-trash)';
    case 'ListRunningProcesses':
      return `Process List (filter: ${action.filter || 'all'})`;
    default:
      return JSON.stringify(action);
  }
}
