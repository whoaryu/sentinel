import React, { useState } from 'react';
import { ArrowRight, Sparkles, Mic, Loader2, ShieldCheck, AlertOctagon, Terminal, X, Zap } from 'lucide-react';
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
  const [isListening, setIsListening] = useState(false);

  const handleVoiceToggle = () => {
    if (!isListening) {
      setIsListening(true);
      setTimeout(() => {
        setPrompt('Clean up files in ~/Downloads older than 90 days');
        setIsListening(false);
      }, 1800);
    } else {
      setIsListening(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && prompt.trim()) {
      onSubmit(prompt);
    }
  };

  const handlePresetClick = (scenario: PresetScenario) => {
    setPrompt(scenario.prompt);
    onSubmit(scenario.prompt);
  };

  const quickPills = [
    'Clean ~/Downloads older than 90d',
    'Move PDFs from Downloads to Documents/PDFs',
    'Kill runaway node.exe process',
    'Delete C:\\Windows\\System32 (Security Test)',
  ];

  return (
    <div className="view-container">
      {/* Editorial Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span className="badge-tag badge-safe">
            <ShieldCheck size={13} /> Strict Separation Architecture
          </span>
          {dryRun && (
            <span className="badge-tag badge-warn">
              <AlertOctagon size={13} /> Simulation Sandbox
            </span>
          )}
        </div>
        <h1>Elevated Task Orchestration</h1>
        <p className="lead">
          Type an instruction in plain English. Sentinel synthesizes a closed-vocabulary action schema and validates it through a pure, zero-I/O policy engine before any elevation occurs.
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

      {/* Quick Pills Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
          Quick prompts:
        </span>
        {quickPills.map((pill) => (
          <button
            key={pill}
            type="button"
            className="btn-secondary"
            style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20 }}
            onClick={() => setPrompt(pill)}
          >
            {pill}
          </button>
        ))}
      </div>

      {/* The Central Command Input Box — High Contrast & Impossible to Miss */}
      <div className="main-input-card">
        <div className="input-card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Terminal size={15} color="var(--accent)" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>
              Natural Language Command Input
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {prompt.length > 0 && (
              <button
                type="button"
                className="clear-input-btn"
                onClick={() => setPrompt('')}
                title="Clear input"
              >
                <X size={13} /> Clear
              </button>
            )}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--fg-dim)' }}>
              {prompt.length} characters
            </span>
          </div>
        </div>

        <textarea
          className="main-textarea"
          placeholder="Type your command here (e.g., Clean up files in Downloads older than 90 days, or move all PDFs to Documents/PDFs)..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          rows={4}
          autoFocus
        />

        <div className="input-card-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className={`btn-secondary ${isListening ? 'badge-accent' : ''}`}
              onClick={handleVoiceToggle}
              title="Voice dictation"
              style={{
                borderColor: isListening ? 'var(--accent)' : undefined,
                color: isListening ? 'var(--accent)' : undefined,
                padding: '8px 14px',
              }}
            >
              {isListening ? (
                <div className="voice-visualizer">
                  <div className="soundwave-bar" />
                  <div className="soundwave-bar" />
                  <div className="soundwave-bar" />
                  <div className="soundwave-bar" />
                  <div className="soundwave-bar" />
                </div>
              ) : (
                <Mic size={14} />
              )}
              <span>{isListening ? 'Listening...' : 'Voice Input'}</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11.5, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
              <kbd style={{ background: 'var(--bg-code)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>Ctrl</kbd> + <kbd style={{ background: 'var(--bg-code)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>Enter</kbd>
            </span>

            <button
              type="button"
              className="btn-primary"
              disabled={isLoading || !prompt.trim()}
              onClick={() => onSubmit(prompt)}
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="spin-icon" />
                  <span>Synthesizing Schema...</span>
                </>
              ) : (
                <>
                  <span>Generate Action Plan</span>
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Preset Benchmarks */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={17} color="var(--accent)" />
            <h2>Interactive Safety Benchmarks</h2>
          </div>
          <span style={{ fontSize: 12, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
            Click to auto-populate and run
          </span>
        </div>

        <div className="presets-grid">
          {PRESET_SCENARIOS.map((scenario) => {
            const badgeClass =
              scenario.badgeColor === 'danger'
                ? 'badge-danger'
                : scenario.badgeColor === 'warn'
                ? 'badge-warn'
                : scenario.badgeColor === 'info'
                ? 'badge-info'
                : 'badge-safe';

            return (
              <div
                key={scenario.id}
                className="preset-card"
                onClick={() => handlePresetClick(scenario)}
              >
                <div className="preset-header">
                  <span className="preset-title">{scenario.title}</span>
                  <span className={`badge-tag ${badgeClass}`}>{scenario.badge}</span>
                </div>
                <div className="preset-desc">{scenario.description}</div>
                <div
                  style={{
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--fg-muted)',
                    marginTop: 4,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  &ldquo;{scenario.prompt}&rdquo;
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
