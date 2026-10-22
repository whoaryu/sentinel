import React from 'react';
import { Terminal, FileCheck, Play, Database, Shield, Lock, HardDrive } from 'lucide-react';

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="nav-section">
          <div className="nav-heading">Orchestration</div>

          <button
            type="button"
            className={`nav-tab ${currentScreen === 'input' ? 'active' : ''}`}
            onClick={() => onSelectScreen('input')}
          >
            <Terminal size={15} />
            <span>Command Studio</span>
          </button>

          <button
            type="button"
            className={`nav-tab ${currentScreen === 'review' ? 'active' : ''}`}
            onClick={() => onSelectScreen('review')}
            disabled={!hasActivePlan}
          >
            <FileCheck size={15} />
            <span>Policy Review</span>
          </button>

          <button
            type="button"
            className={`nav-tab ${currentScreen === 'execution' ? 'active' : ''}`}
            onClick={() => onSelectScreen('execution')}
            disabled={!hasActiveExecution}
          >
            <Play size={15} />
            <span>Telemetry Stream</span>
          </button>
        </div>

        <div className="nav-section">
          <div className="nav-heading">Persistence</div>

          <button
            type="button"
            className={`nav-tab ${currentScreen === 'audit' ? 'active' : ''}`}
            onClick={() => onSelectScreen('audit')}
          >
            <Database size={15} />
            <span>Audit Trail</span>
          </button>
        </div>
      </div>

      {/* System Security Telemetry Footprint */}
      <div className="sidebar-telemetry">
        <div className="telemetry-row">
          <span className="telemetry-label">Sandbox Root</span>
          <span className="telemetry-val">~/Downloads</span>
        </div>
        <div className="telemetry-row">
          <span className="telemetry-label">Policy Verifier</span>
          <span className="telemetry-val" style={{ color: 'var(--safe-contrast)' }}>Zero-I/O Sync</span>
        </div>
        <div className="telemetry-row">
          <span className="telemetry-label">Elevation Level</span>
          <span className="telemetry-val">UAC Guarded</span>
        </div>
      </div>
    </aside>
  );
};
