import React, { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  Terminal,
  RotateCcw,
  Database,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  FolderSync,
} from 'lucide-react';
import { ActionRuntimeState, EvaluatedPlan, ExecutionEvent } from '../types/sentinel';

interface ExecutionScreenProps {
  evaluation: EvaluatedPlan;
  states: ActionRuntimeState[];
  events: ExecutionEvent[];
  isComplete: boolean;
  dryRun: boolean;
  onViewAudit: () => void;
  onNewTask: () => void;
}

export const ExecutionScreen: React.FC<ExecutionScreenProps> = ({
  evaluation,
  states,
  events,
  isComplete,
  dryRun,
  onViewAudit,
  onNewTask,
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
  };

  return (
    <div className="view-container">
      {/* Top Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span className={`badge-tag ${dryRun ? 'badge-warn' : 'badge-accent'}`}>
            <ShieldCheck size={12} />
            {dryRun ? 'Dry-Run Simulation Active' : 'Elevated Task Executor'}
          </span>
          <span className="badge-tag badge-muted">
            Plan ID: {evaluation.plan.id.slice(0, 8)}
          </span>
        </div>
        <h1>
          {isComplete
            ? dryRun
              ? 'Simulation Completed'
              : 'Execution Completed'
            : dryRun
            ? 'Simulating Execution...'
            : 'Executing Elevated Actions...'}
        </h1>
        <p className="lead">
          {dryRun
            ? 'Simulating privileged operations in memory without altering your disk state.'
            : 'Performing least-privilege operations with automated soft-delete trash staging.'}
        </p>
      </div>

      {/* Progress Bar */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--fg)' }}>
            Status: {isComplete ? 'Finished' : 'In Progress'}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 700 }}>
            {progressPercent}% ({completedCount + failedCount}/{totalCount})
          </span>
        </div>
        <div className="progress-bar-container">
          <div
            className="progress-bar-fill"
            style={{
              width: `${progressPercent}%`,
              background: dryRun ? 'var(--warn)' : 'var(--accent)',
            }}
          />
        </div>
      </div>

      {/* Execution Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2>Live Step Progression</h2>
        <div className="live-stream-list">
          {states.map((st) => {
            return (
              <div
                key={st.index}
                className={`stream-row ${st.status}`}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  {/* Status Indicator Icon */}
                  <div>
                    {st.status === 'pending' && <Clock size={18} color="var(--fg-dim)" />}
                    {st.status === 'running' && (
                      <Loader2 size={18} color="var(--accent)" className="spin-icon" />
                    )}
                    {st.status === 'completed' && (
                      <CheckCircle size={18} color="var(--accent)" />
                    )}
                    {st.status === 'failed' && (
                      <XCircle size={18} color="var(--danger)" />
                    )}
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13 }}>
                        #{st.index + 1}
                      </span>
                      <span className="badge-tag badge-muted" style={{ padding: '2px 8px' }}>
                        {st.action.type}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--fg)' }}>
                        {st.message || ('reason' in st.action ? (st.action as any).reason : '')}
                      </span>
                    </div>

                    {st.error && (
                      <div style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                        {st.error}
                      </div>
                    )}
                  </div>
                </div>

                {/* Metrics */}
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-dim)' }}>
                  {st.status === 'completed' && (
                    <span style={{ color: 'var(--accent)' }}>
                      {st.bytesFreed ? `+${(st.bytesFreed / 1048576).toFixed(1)} MB` : 'Done'}
                    </span>
                  )}
                  {st.status === 'running' && <span style={{ color: 'var(--accent)' }}>Running...</span>}
                  {st.status === 'pending' && <span>Pending</span>}
                  {st.status === 'failed' && <span style={{ color: 'var(--danger)' }}>Blocked</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Event Terminal */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Terminal size={15} color="var(--accent)" />
          <h3>WebSocket Event Stream</h3>
        </div>

        <div className="terminal-window">
          {events.length === 0 ? (
            <div style={{ color: 'var(--fg-dim)' }}>Awaiting execution dispatcher...</div>
          ) : (
            events.map((ev, i) => (
              <div key={i} className="terminal-line">
                <span className="terminal-time">[{ev.timestamp.slice(11, 19)}]</span>
                {ev.type === 'ActionCompleted' && (
                  <span className="terminal-ok">
                    ✓ [{ev.action_type}] {ev.message || 'Completed'} (
                    {ev.files_affected ? `${ev.files_affected} files, ` : ''}
                    {(ev.bytes_freed ? ev.bytes_freed / 1048576 : 0).toFixed(1)} MB)
                  </span>
                )}
                {ev.type === 'ActionFailed' && (
                  <span className="terminal-err">
                    ✗ [{ev.action_type}] {ev.error}
                  </span>
                )}
                {ev.type === 'ActionStarted' && (
                  <span className="terminal-msg">
                    ▶ [{ev.action_type}] {ev.message}
                  </span>
                )}
                {ev.type === 'PlanCompleted' && (
                  <span className="terminal-ok" style={{ fontWeight: 700 }}>
                    ★ [PlanCompleted] Total: {ev.total_actions}, Succeeded: {ev.succeeded}, Failed: {ev.failed}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Final Completion Summary Card */}
      {isComplete && (
        <div className="card" style={{ borderColor: 'var(--border-mid)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle size={22} color="var(--accent)" />
              <h2>{dryRun ? 'Simulation Summary' : 'Execution Summary'}</h2>
            </div>
            <span className="badge-tag badge-accent">
              Append-Only Audit Stored
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 20 }}>
            <div className="card" style={{ padding: 14, background: 'var(--bg-code)' }}>
              <span className="metric-label">Completed</span>
              <span className="metric-value" style={{ color: 'var(--accent)' }}>
                {completedCount} / {totalCount}
              </span>
            </div>

            <div className="card" style={{ padding: 14, background: 'var(--bg-code)' }}>
              <span className="metric-label">Blocked / Skipped</span>
              <span className="metric-value" style={{ color: failedCount > 0 ? 'var(--danger)' : 'var(--fg)' }}>
                {failedCount}
              </span>
            </div>

            <div className="card" style={{ padding: 14, background: 'var(--bg-code)' }}>
              <span className="metric-label">Freed Storage</span>
              <span className="metric-value">
                {(totalFreedBytes / 1048576).toFixed(1)} MB
              </span>
            </div>

            <div className="card" style={{ padding: 14, background: 'var(--bg-code)' }}>
              <span className="metric-label">Safety Retention</span>
              <span className="metric-value" style={{ fontSize: 13.5 }}>
                ~/.sentinel-trash/
              </span>
            </div>
          </div>

          {/* Undo Action if reversible */}
          {hasReversibleActions && (
            <div
              style={{
                marginBottom: 20,
                padding: '12px 16px',
                background: 'var(--info-dim)',
                border: '1px solid rgba(126, 184, 255, 0.3)',
                borderRadius: 'var(--radius)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <RotateCcw size={18} color="var(--info)" />
                <span style={{ fontSize: 13.5, color: 'var(--fg)' }}>
                  {isUndone
                    ? 'Reversible actions have been restored.'
                    : 'This plan contains reversible move operations. You can revert them now.'}
                </span>
              </div>
              <button
                className="btn-secondary"
                disabled={isUndone}
                onClick={handleUndo}
                style={{ fontSize: 13, padding: '6px 14px' }}
              >
                {isUndone ? '✓ Undone' : '1-Click Undo'}
              </button>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button className="btn-secondary" onClick={onViewAudit}>
              <Database size={16} />
              <span>View in Audit Trail</span>
            </button>

            <button className="btn-primary" onClick={onNewTask}>
              <span>New Task</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
