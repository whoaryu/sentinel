import React, { useState, useEffect } from 'react';
import { X, Key, Cpu, CheckCircle2, AlertCircle, Zap, ExternalLink } from 'lucide-react';

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
            <div className="gemini-icon-badge" style={{ background: 'linear-gradient(135deg, #f97316, #fb923c)' }}>
              <Zap size={16} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--fg)' }}>
                Groq Intelligence Settings
              </h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-muted)' }}>
                Configure Groq API credentials — ultra-fast Llama 3.3 inference
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
                <Key size={14} /> Groq API Key
              </span>
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
              >
                Get free API Key <ExternalLink size={10} />
              </a>
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showKey ? 'text' : 'password'}
                className="input-field"
                placeholder="gsk_..."
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
              Saved locally in browser storage or read from <code>GROQ_API_KEY</code> in <code>.env</code> on the backend.
            </span>
          </div>

          {/* Model Selector */}
          <div className="form-group">
            <label className="form-label">
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Cpu size={14} /> Groq Model
              </span>
            </label>
            <div className="model-grid">
              {[
                { id: 'openai/gpt-oss-20b', name: 'OpenAI GPT-OSS 20B', tag: 'Fast reasoning — recommended' },
                { id: 'openai/gpt-oss-120b', name: 'OpenAI GPT-OSS 120B', tag: 'High capability model' },
                { id: 'qwen/qwen3.8-27b', name: 'Qwen 3.8 27B', tag: 'Fast multilingual model' },
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
