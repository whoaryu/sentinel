import React, { useState } from 'react';
import { CheckCircle2, XCircle, Loader2, ArrowRight, RotateCcw, Database, Terminal, Shield, FileText } from 'lucide-react';
import { ActionRuntimeState, EvaluatedPlan, ExecutionEvent } from '../types/sentinel';

interface ExecutionScreenProps {
  evaluation: EvaluatedPlan;
  states: ActionRuntimeState[];
  events: ExecutionEvent[];
  isComplete: boolean;
  dryRun: boolean;
  onViewAudit: () => void;
  onNewTask: () => void;
  onRollback?: () => void;
}

export const ExecutionScreen: React.FC<ExecutionScreenProps> = ({
  evaluation,
  states,
  events,
  isComplete,
  dryRun,
  onViewAudit,
  onNewTask,
  onRollback,
}) => {
  const [isUndone, setIsUndone] = useState(false);

  const completedCount = states.filter((s) => s.status === 'completed').length;
  const failedCount = states.filter((s) => s.status === 'failed').length;
  const totalCount = states.length;
  const progressPercent = totalCount > 0 ? Math.round(((completedCount + failedCount) / totalCount) * 100) : 0;

  const totalFreedBytes = states.reduce((acc, s) => acc + (s.bytesFreed || 0), 0);
  const totalAffectedFiles = states.reduce((acc, s) => acc + (s.filesAffected || 0), 0);

  const hasReversibleActions = evaluation.evaluated_actions.some((ea) => ea.reversible);

  const handleUndo = () => {
    setIsUndone(true);
    if (onRollback) {
      onRollback();
    }
  };

  return (
    <div className="view-container">
      {/* Title & Status */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span className={`badge-tag ${dryRun ? 'badge-safe' : 'badge-warn'}`}>
            <Shield size={11} />
            {dryRun ? 'Simulation Environment (Read-Only)' : 'Elevated Task Executor'}
          </span>
          <span className="badge-tag">
            Plan ID: {evaluation.plan.id.slice(0, 8)}
          </span>
        </div>

        <h1>Execution Telemetry Stream</h1>
        <p className="lead">
          Real-time event stream dispatched from Sentinel&apos;s least-privilege executor. Every single action outcome is committed to the append-only SQLite audit log.
        </p>
      </div>

      {/* Progress & Live Metric Bar */}
      <div className="impact-banner">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, paddingRight: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-secondary)', fontFamily: 'var(--font-mono)' }}>
              {isComplete ? 'Execution Completed' : 'Executing Action Plan...'}
            </span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--fg-primary)' }}>
              {progressPercent}%
            </span>
          </div>

          <div className="execution-progress-bar">
            <div
              className="execution-progress-fill"
              style={{
                width: `${progressPercent}%`,
                background: failedCount > 0 && completedCount === 0 ? 'var(--danger)' : 'var(--accent)',
              }}
            />
          </div>
        </div>

        <div className="impact-metrics">
          <div className="metric-col">
            <span className="metric-col-label">Affected</span>
            <span className="metric-col-val">{totalAffectedFiles}</span>
          </div>
          <div className="metric-col">
            <span className="metric-col-label">Reclaimed</span>
            <span className="metric-col-val">{(totalFreedBytes / (1024 * 1024)).toFixed(1)} MB</span>
          </div>
        </div>
      </div>

      {/* Step by Step Execution Rows */}
      <div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>
          Dispatched Actions Pipeline
        </div>

        <div className="actions-list">
          {states.map((st) => (
            <div
              key={st.index}
              className="action-card"
              style={{
                borderColor:
                  st.status === 'completed'
                    ? 'var(--safe-border)'
                    : st.status === 'failed'
                    ? 'var(--danger-border)'
                    : st.status === 'running'
                    ? 'var(--accent-border)'
                    : undefined,
              }}
            >
              <div className="action-card-header">
                <div className="action-type-label">
                  <span style={{ color: 'var(--fg-muted)' }}>#{String(st.index + 1).padStart(2, '0')}</span>
                  <span>{st.action.type}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {st.status === 'pending' && (
                    <span className="badge-tag badge-muted">Pending</span>
                  )}
                  {st.status === 'running' && (
                    <span className="badge-tag badge-accent">
                      <Loader2 size={11} className="spin" /> Executing
                    </span>
                  )}
                  {st.status === 'completed' && (
                    <span className="badge-tag badge-safe">
                      <CheckCircle2 size={11} /> Done
                    </span>
                  )}
                  {st.status === 'failed' && (
                    <span className="badge-tag badge-danger">
                      <XCircle size={11} /> Blocked / Failed
                    </span>
                  )}
                </div>
              </div>

              {st.message && (
                <div style={{ fontSize: 12.5, color: st.status === 'failed' ? 'var(--danger-contrast)' : 'var(--fg-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {st.message}
                </div>
              )}

              {st.details && st.details.length > 0 && (
                <div className="matched-files-panel">
                  <div className="matched-files-header">
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <FileText size={12} />
                      Matched & Staged Files ({st.details.length} item{st.details.length > 1 ? 's' : ''})
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>Sandbox Telemetry</span>
                  </div>
                  <div className="matched-files-list">
                    {st.details.map((item, dIdx) => (
                      <div key={dIdx} className="matched-file-item">
                        <span className="matched-file-num">#{dIdx + 1}</span>
                        <span className="matched-file-path">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Terminal Raw Event Stream */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Terminal size={13} style={{ color: 'var(--fg-muted)' }} />
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-mono)' }}>
            Real-Time Telemetry Feed (JSON-RPC)
          </span>
        </div>

        <div className="terminal-shell">
          {events.length === 0 ? (
            <div style={{ color: 'var(--fg-faint)', fontStyle: 'italic' }}>
              Waiting for execution dispatch events...
            </div>
          ) : (
            events.map((ev, i) => (
              <div key={i} className="terminal-event-row">
                <span className="terminal-ts">
                  {new Date(ev.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={`terminal-msg ${ev.type === 'ActionFailed' ? 'error' : ev.type === 'ActionCompleted' ? 'success' : ''}`}>
                  [{ev.type}] {ev.message || (ev.error ? `Error: ${ev.error}` : JSON.stringify(ev))}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Bottom Completion Actions */}
      {isComplete && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTop: '1px solid var(--border-hairline)' }}>
          <div>
            {hasReversibleActions && (
              <button
                type="button"
                className="btn-secondary"
                disabled={isUndone}
                onClick={handleUndo}
              >
                <RotateCcw size={13} />
                <span>{isUndone ? '✓ Rolled Back' : '1-Click Rollback'}</span>
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onViewAudit}
            >
              <Database size={13} />
              <span>Inspect in Audit Trail</span>
            </button>

            <button
              type="button"
              className="btn-primary"
              onClick={onNewTask}
            >
              <span>New Command</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
