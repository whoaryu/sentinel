import React, { useState } from 'react';
import { HelpCircle, ArrowRight } from 'lucide-react';

interface ClarificationCardProps {
  question: string;
  onRespond: (refinedPrompt: string) => void;
  onCancel: () => void;
}

export const ClarificationCard: React.FC<ClarificationCardProps> = ({
  question,
  onRespond,
  onCancel,
}) => {
  const [customAnswer, setCustomAnswer] = useState('');

  const quickOptions = [
    'Clean files older than 90 days',
    'Clean files older than 30 days',
    'Move all PDFs and documents into subfolders',
  ];

  return (
    <div className="card" style={{ borderColor: 'rgba(245, 166, 35, 0.4)', background: 'var(--warn-dim)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <HelpCircle size={20} color="var(--warn)" />
        <h3 style={{ color: 'var(--warn)' }}>Clarification Required</h3>
      </div>

      <p style={{ fontSize: 14.5, marginBottom: 16, color: 'var(--fg)' }}>
        {question}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
          Select a quick criteria:
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {quickOptions.map((opt) => (
            <button
              key={opt}
              className="btn-secondary"
              style={{ fontSize: 13, padding: '6px 12px' }}
              onClick={() => onRespond(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <input
          type="text"
          className="input-field"
          style={{ flex: 1 }}
          placeholder="Or type specific instructions..."
          value={customAnswer}
          onChange={(e) => setCustomAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customAnswer.trim()) {
              onRespond(customAnswer);
            }
          }}
        />
        <button
          className="btn-primary"
          disabled={!customAnswer.trim()}
          onClick={() => onRespond(customAnswer)}
        >
          Refine <ArrowRight size={14} />
        </button>
        <button className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
};
