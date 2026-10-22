import React from 'react';
import { Shield, Sun, Moon, Sliders, Sparkles, Server, CheckCircle2, AlertCircle, ChevronRight, Settings } from 'lucide-react';
import { NavScreen } from './Sidebar';

interface HeaderProps {
  currentScreen: NavScreen;
  dryRun: boolean;
  setDryRun: (val: boolean) => void;
  theme: 'dark' | 'light';
  setTheme: (t: 'dark' | 'light') => void;
  onNavigateHome: () => void;
  backendOnline: boolean;
  geminiModel: string;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentScreen,
  dryRun,
  setDryRun,
  theme,
  setTheme,
  onNavigateHome,
  backendOnline,
  geminiModel,
  onOpenSettings,
}) => {
  return (
    <header className="top-nav">
      <div className="brand" onClick={onNavigateHome} role="button" tabIndex={0}>
        <div className="brand-icon-wrapper">
          <div className="brand-icon">
            <Shield size={19} strokeWidth={2.4} />
          </div>
        </div>
        <div className="brand-title">
          <span>Sentinel</span>
          <span className="brand-subtitle">OS</span>
        </div>
        <span className="badge-tag badge-accent" style={{ marginLeft: 6, fontSize: 11 }}>
          <Sparkles size={11} style={{ marginRight: 3 }} /> Gemini 2.5
        </span>
      </div>

      {/* State Machine Pipeline Indicator */}
      <div className="workflow-pipeline">
        <span className={`pipeline-step ${currentScreen === 'input' ? 'active' : 'done'}`}>
          1. Intent
        </span>
        <ChevronRight size={10} className="pipeline-divider" />
        <span className={`pipeline-step ${currentScreen === 'review' ? 'active' : currentScreen === 'execution' || currentScreen === 'audit' ? 'done' : ''}`}>
          2. Policy Engine
        </span>
        <ChevronRight size={10} className="pipeline-divider" />
        <span className={`pipeline-step ${currentScreen === 'execution' ? 'active' : currentScreen === 'audit' ? 'done' : ''}`}>
          3. Privileged Execution
        </span>
        <ChevronRight size={10} className="pipeline-divider" />
        <span className={`pipeline-step ${currentScreen === 'audit' ? 'active' : ''}`}>
          4. Audit Trail
        </span>
      </div>

      <div className="header-status-group">
        {/* Backend & Gemini Status Pill */}
        <button
          type="button"
          className="api-status-pill"
          onClick={onOpenSettings}
          title="Configure Gemini & Backend connection"
        >
          <div className={`pulse-indicator ${backendOnline ? 'online' : 'local'}`} />
          <span className="api-status-label">
            {backendOnline ? 'Rust Core :3001' : 'Local Twin'}
          </span>
          <span className="api-model-subtag">
            {geminiModel.replace('gemini-', '')}
          </span>
          <Settings size={12} style={{ marginLeft: 4, opacity: 0.6 }} />
        </button>

        {/* Start Fresh Task */}
        <button
          className="btn-primary"
          style={{ padding: '6px 14px', fontSize: 12.5 }}
          onClick={onNavigateHome}
          title="Start a new command"
        >
          + New Prompt
        </button>

        {/* Dry-run simulation switch */}
        <button
          className={`sim-switch ${dryRun ? 'active' : ''}`}
          onClick={() => setDryRun(!dryRun)}
          title={dryRun ? 'Simulation mode active (zero disk writes)' : 'Live mode active (real OS operations)'}
        >
          <Sliders size={13} />
          <span>{dryRun ? 'Sim: Safe' : 'Live: Active'}</span>
        </button>

        {/* Theme toggle */}
        <button
          className="sim-switch icon-only"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="Toggle color theme"
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </header>
  );
};
