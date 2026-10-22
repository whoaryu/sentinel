import React from 'react';
import { Shield, Sun, Moon, Sliders, CheckCircle, ChevronRight } from 'lucide-react';
import { NavScreen } from './Sidebar';

interface HeaderProps {
  currentScreen: NavScreen;
  dryRun: boolean;
  setDryRun: (val: boolean) => void;
  theme: 'dark' | 'light';
  setTheme: (t: 'dark' | 'light') => void;
  onNavigateHome: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentScreen,
  dryRun,
  setDryRun,
  theme,
  setTheme,
  onNavigateHome,
}) => {
  return (
    <header className="top-nav">
      <div className="brand" onClick={onNavigateHome}>
        <div className="brand-icon-wrapper">
          <div className="brand-icon">
            <Shield size={19} strokeWidth={2.4} />
          </div>
        </div>
        <div className="brand-title">
          <span>Sentinel</span> OS
        </div>
        <span className="badge-tag badge-safe" style={{ marginLeft: 6 }}>
          <div className="pulse-dot" /> Least-Privilege
        </span>
      </div>

      {/* State Machine Pipeline Indicator */}
      <div className="workflow-pipeline">
        <span className={`pipeline-step ${currentScreen === 'input' ? 'active' : 'done'}`}>
          1. Drafting
        </span>
        <ChevronRight size={10} className="pipeline-divider" />
        <span className={`pipeline-step ${currentScreen === 'review' ? 'active' : currentScreen === 'execution' || currentScreen === 'audit' ? 'done' : ''}`}>
          2. Policy Engine
        </span>
        <ChevronRight size={10} className="pipeline-divider" />
        <span className={`pipeline-step ${currentScreen === 'execution' ? 'active' : currentScreen === 'audit' ? 'done' : ''}`}>
          3. Elevated Execution
        </span>
        <ChevronRight size={10} className="pipeline-divider" />
        <span className={`pipeline-step ${currentScreen === 'audit' ? 'active' : ''}`}>
          4. Audit Trail
        </span>
      </div>

      <div className="header-status-group">
        {/* Prominent New Task Button */}
        <button
          className="btn-primary"
          style={{ padding: '6px 14px', fontSize: 12.5 }}
          onClick={onNavigateHome}
          title="Start fresh command"
        >
          + New Prompt
        </button>

        {/* Dry-run simulation switch */}
        <button
          className={`sim-switch ${dryRun ? 'active' : ''}`}
          onClick={() => setDryRun(!dryRun)}
          title="Toggle Simulation Mode"
        >
          <Sliders size={14} />
          <span>{dryRun ? 'Simulation: ON' : 'Live Mode'}</span>
        </button>

        {/* Theme button */}
        <button
          className="sim-switch"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="Toggle color theme"
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </div>
    </header>
  );
};
