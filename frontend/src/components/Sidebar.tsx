import React from 'react';
import { Terminal, FileCheck, Play, Database, ShieldAlert } from 'lucide-react';

export type NavScreen = 'input' | 'review' | 'execution' | 'audit';

interface SidebarProps {
  currentScreen: NavScreen;
  onSelectScreen: (screen: NavScreen) => void;
  hasActivePlan: boolean;
  hasActiveExecution: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentScreen,
  onSelectScreen,
  hasActivePlan,
  hasActiveExecution,
}) => {
  return (
    <aside className="sidebar">
      <div className="nav-section">
        <div className="nav-heading">Workflow</div>

        <button
          className={`nav-tab ${currentScreen === 'input' ? 'active' : ''}`}
          onClick={() => onSelectScreen('input')}
        >
          <Terminal size={16} />
          <span>Natural Input</span>
        </button>

        <button
          className={`nav-tab ${currentScreen === 'review' ? 'active' : ''}`}
          onClick={() => onSelectScreen('review')}
          disabled={!hasActivePlan}
          style={{ opacity: hasActivePlan ? 1 : 0.45 }}
        >
          <FileCheck size={16} />
          <span>Plan Review</span>
        </button>

        <button
          className={`nav-tab ${currentScreen === 'execution' ? 'active' : ''}`}
          onClick={() => onSelectScreen('execution')}
          disabled={!hasActiveExecution}
          style={{ opacity: hasActiveExecution ? 1 : 0.45 }}
        >
          <Play size={16} />
          <span>Live Execution</span>
        </button>
      </div>

      <div className="nav-section">
        <div className="nav-heading">Records</div>
        <button
          className={`nav-tab ${currentScreen === 'audit' ? 'active' : ''}`}
          onClick={() => onSelectScreen('audit')}
        >
          <Database size={16} />
          <span>Audit Log</span>
        </button>

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
            <ShieldAlert size={12} color="var(--accent)" /> Pure Policy Engine
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-dim)' }}>
            Zero Shell Execution. Closed typed Action schema.
          </div>
        </div>
      </div>
    </aside>
  );
};
