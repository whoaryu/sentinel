import React, { useState, useEffect } from 'react';
import { X, Key, Cpu, Server, CheckCircle2, AlertCircle, Sparkles, ExternalLink } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  geminiKey: string;
  setGeminiKey: (k: string) => void;
  geminiModel: string;
  setGeminiModel: (m: string) => void;
  backendOnline: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  geminiKey,
  setGeminiKey,
  geminiModel,
  setGeminiModel,
  backendOnline,
}) => {
  const [tempKey, setTempKey] = useState(geminiKey);
  const [tempModel, setTempModel] = useState(geminiModel);
  const [showKey, setShowKey] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    setTempKey(geminiKey);
    setTempModel(geminiModel);
  }, [geminiKey, geminiModel, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    setGeminiKey(tempKey.trim());
    setGeminiModel(tempModel);
    localStorage.setItem('sentinel_gemini_key', tempKey.trim());
    localStorage.setItem('sentinel_gemini_model', tempModel);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 700);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="gemini-icon-badge">
              <Sparkles size={16} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--fg)' }}>
                Gemini Intelligence Settings
              </h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-muted)' }}>
                Configure Google Generative Language client credentials
              </p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} title="Close settings">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* Backend Health Banner */}
          <div className={`health-banner ${backendOnline ? 'health-banner-online' : 'health-banner-offline'}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {backendOnline ? <CheckCircle2 size={16} className="text-safe" /> : <AlertCircle size={16} className="text-warn" />}
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {backendOnline ? 'Sentinel Rust Engine: Online (Port 3001)' : 'Sentinel Rust Engine: Offline (Local Twin Active)'}
              </span>
            </div>
            <span className="badge-tag" style={{ fontSize: 11 }}>
              {backendOnline ? 'Native Windows Executor' : 'In-Browser Simulator'}
            </span>
          </div>

          {/* API Key Input */}
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Key size={14} /> Google Gemini API Key
              </span>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
              >
                Get API Key <ExternalLink size={10} />
              </a>
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showKey ? 'text' : 'password'}
                className="input-field"
                placeholder="AIzaSy..."
                value={tempKey}
                onChange={(e) => setTempKey(e.target.value)}
                style={{ paddingRight: 64, fontFamily: 'var(--font-mono)' }}
              />
              <button
                type="button"
                className="input-inline-btn"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <span className="form-hint">
              Saved locally in browser storage or read from <code>GEMINI_API_KEY</code> in <code>.env</code> on the backend.
            </span>
          </div>

          {/* Model Selector */}
          <div className="form-group">
            <label className="form-label">
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Cpu size={14} /> Gemini Model Variant
              </span>
            </label>
            <div className="model-grid">
              {[
                { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', tag: 'Fastest & Structured (Recommended)' },
                { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', tag: 'High Throughput' },
                { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', tag: 'Next-Gen Preview' },
                { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', tag: 'Deep Reasoning' },
              ].map((m) => (
                <div
                  key={m.id}
                  className={`model-option-card ${tempModel === m.id ? 'active' : ''}`}
                  onClick={() => setTempModel(m.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{m.name}</span>
                    {tempModel === m.id && <CheckCircle2 size={14} style={{ color: 'var(--accent)' }} />}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>{m.tag}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleSave}>
            {savedSuccess ? '✓ Saved!' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
};
