import React from 'react';
import { ArrowRight, Terminal, Shield, Folder, FileText, Cpu, Archive, Trash2, Search, AlertCircle, CornerDownLeft } from 'lucide-react';
import { PRESET_SCENARIOS, PresetScenario } from '../services/mockData';
import { ClarificationCard } from '../components/ClarificationCard';

interface InputScreenProps {
  prompt: string;
  setPrompt: (p: string) => void;
  onSubmit: (promptText: string) => void;
  isLoading: boolean;
  clarificationQuestion: string | null;
  onResolveClarification: (refinedPrompt: string) => void;
  onCancelClarification: () => void;
  dryRun: boolean;
  setDryRun: (v: boolean) => void;
}

export const InputScreen: React.FC<InputScreenProps> = ({
  prompt,
  setPrompt,
  onSubmit,
  isLoading,
  clarificationQuestion,
  onResolveClarification,
  onCancelClarification,
  dryRun,
  setDryRun,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && prompt.trim()) {
      e.preventDefault();
      onSubmit(prompt);
    }
  };

  const handleSelectScenario = (scenario: PresetScenario) => {
    setPrompt(scenario.prompt);
    onSubmit(scenario.prompt);
  };

  const capabilities = [
    {
      icon: <Trash2 size={14} />,
      title: 'DeleteFilesMatching',
      desc: 'Pattern-based deletion with mandatory age filters and soft-delete trash staging.',
    },
    {
      icon: <Folder size={14} />,
      title: 'MoveFilesMatching',
      desc: 'Batch file reorganization across directory boundaries with automatic inverse logging.',
    },
    {
      icon: <Cpu size={14} />,
      title: 'KillProcess',
      desc: 'Targeted process termination by PID or name. Protected system binaries strictly blocked.',
    },
    {
      icon: <Archive size={14} />,
      title: 'CompressDirectory',
      desc: 'Archive folders to zip archives. Deleting source directory requires confirmation.',
    },
    {
      icon: <Search size={14} />,
      title: 'FindLargeFiles',
      desc: 'Read-only storage telemetry finding items exceeding configurable megabyte caps.',
    },
    {
      icon: <Shield size={14} />,
      title: 'Pure Policy Engine',
      desc: 'Zero-I/O safety guarantees rejecting path traversals (..) and root escalations.',
    },
  ];

  return (
    <div className="view-container">
      {/* Title & Overview */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span className="badge-tag badge-accent">
            <Terminal size={11} /> Natural Language Orchestration
          </span>
          <span className="badge-tag">
            Target OS: Windows 11
          </span>
        </div>
        <h1>Command Studio</h1>
        <p className="lead">
          Describe an elevated system operation in plain English. The AI synthesizes a strictly-typed, closed ActionPlan validated by Sentinel&apos;s pure Rust policy engine before any privileged token is dispatched.
        </p>
      </div>

      {/* Clarification Alert if active */}
      {clarificationQuestion && (
        <ClarificationCard
          question={clarificationQuestion}
          onRespond={onResolveClarification}
          onCancel={onCancelClarification}
        />
      )}

      {/* Primary Command Input Component */}
      <div className="command-card">
        <div className="command-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-secondary)', fontFamily: 'var(--font-mono)' }}>
              $ sentinel plan
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className={`badge-tag ${dryRun ? 'badge-safe' : 'badge-warn'}`}
              onClick={() => setDryRun(!dryRun)}
              style={{ cursor: 'pointer', border: '1px solid currentColor' }}
            >
              {dryRun ? 'Mode: Dry-Run Simulation' : 'Mode: Live Execution'}
            </button>
            {prompt.length > 0 && (
              <button
                type="button"
                className="badge-tag badge-muted"
                onClick={() => setPrompt('')}
                style={{ cursor: 'pointer' }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <textarea
          className="command-textarea"
          rows={3}
          placeholder="e.g. Show me all files in downloads older than 1 year, or move loose PDFs to Documents/PDFs..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          autoFocus
        />

        <div className="command-footer">
          <div className="command-keyboard-hint">
            Press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to synthesize plan
          </div>

          <button
            type="button"
            className="btn-primary"
            disabled={!prompt.trim() || isLoading}
            onClick={() => onSubmit(prompt)}
          >
            {isLoading ? (
              <span>Evaluating Policy...</span>
            ) : (
              <>
                <span>Synthesize Action Plan</span>
                <CornerDownLeft size={13} />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Quick Verified Scenarios */}
      <div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>
          Verified Test Scenarios
        </div>
        <div className="pills-container">
          {PRESET_SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              className="pill-btn"
              onClick={() => handleSelectScenario(scenario)}
              title={scenario.description}
            >
              <span style={{ color: scenario.badgeColor === 'danger' ? 'var(--danger-contrast)' : scenario.badgeColor === 'warn' ? 'var(--warn-contrast)' : 'var(--fg-primary)' }}>
                {scenario.prompt}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Closed Action Architecture Section */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-mono)' }}>
            Closed Execution Vocabulary
          </div>
          <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>
            Raw shell commands (<code style={{ fontFamily: 'var(--font-mono)', color: 'var(--danger-contrast)' }}>bash / cmd.exe</code>) are architecturally excluded
          </span>
        </div>

        <div className="capabilities-grid">
          {capabilities.map((c, i) => (
            <div key={i} className="capability-card">
              <div className="capability-card-title">
                <span style={{ color: 'var(--accent)' }}>{c.icon}</span>
                <code>{c.title}</code>
              </div>
              <div className="capability-card-desc">{c.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
