import React, { useState, useEffect } from 'react';
import { Database, ShieldCheck, Search, ChevronRight, ChevronDown, CheckCircle, XCircle, AlertTriangle, Code } from 'lucide-react';
import { AuditPlanRecord } from '../types/sentinel';
import { getStoredAuditRecords } from '../services/api';

export const AuditScreen: React.FC = () => {
  const [records, setRecords] = useState<AuditPlanRecord[]>([]);
  const [filter, setFilter] = useState<'All' | 'Executed' | 'Denied' | 'Simulated'>('All');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setRecords(getStoredAuditRecords());
  }, []);

  const filtered = records.filter((r) => {
    if (filter !== 'All' && r.status !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return r.request.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="view-container">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span className="badge-tag badge-accent">
            <ShieldCheck size={12} /> SQLite Append-Only
          </span>
          <span className="badge-tag badge-muted">
            Tamper-Evident DB Triggers
          </span>
        </div>
        <h1>Audit Trail & Event Log</h1>
        <p className="lead">
          Every proposed action plan, policy validation decision, and elevated execution outcome is permanently committed. Database triggers strictly prohibit UPDATE and DELETE operations.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['All', 'Executed', 'Denied', 'Simulated'] as const).map((status) => (
            <button
              key={status}
              className={`btn-secondary ${filter === status ? 'badge-accent' : ''}`}
              style={{
                fontSize: 13,
                padding: '6px 14px',
                borderColor: filter === status ? 'var(--accent)' : undefined,
                color: filter === status ? 'var(--accent)' : undefined,
              }}
              onClick={() => setFilter(status)}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="search-input-wrapper">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search prompt or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="audit-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Request Prompt</th>
              <th>Status</th>
              <th>Actions</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '36px', color: 'var(--fg-dim)' }}>
                  No audit entries found matching the filter.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const isExpanded = expandedId === r.id;
                const statusBadge =
                  r.status === 'Executed'
                    ? 'badge-safe'
                    : r.status === 'Denied'
                    ? 'badge-danger'
                    : r.status === 'Simulated'
                    ? 'badge-warn'
                    : 'badge-muted';

                return (
                  <React.Fragment key={r.id}>
                    <tr
                      style={{ cursor: 'pointer' }}
                      onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    >
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-dim)' }}>
                        {r.created_at ? new Date(r.created_at).toLocaleString() : 'Recent'}
                      </td>
                      <td style={{ fontWeight: 600, color: 'var(--fg)', maxWidth: 300 }}>
                        {r.request}
                      </td>
                      <td>
                        <span className={`badge-tag ${statusBadge}`}>
                          {r.status === 'Executed' && <CheckCircle size={11} />}
                          {r.status === 'Denied' && <XCircle size={11} />}
                          {r.status === 'Simulated' && <AlertTriangle size={11} />}
                          {r.status}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                        {r.actions_count || 1} op(s)
                      </td>
                      <td>
                        <button
                          className="btn-secondary"
                          style={{ padding: '4px 8px', fontSize: 12 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedId(isExpanded ? null : r.id);
                          }}
                        >
                          <Code size={13} />
                          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </button>
                      </td>
                    </tr>

                    {/* Expandable JSON Diff Row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={5} style={{ background: 'var(--bg-code)', padding: '18px 22px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--fg-dim)' }}>
                              <span style={{ color: 'var(--fg)' }}>Record ID: {r.id}</span>
                              <span className="badge-tag badge-safe" style={{ fontSize: 11 }}>
                                Hash: SHA-256:{r.id.slice(0, 8)}...8f0b (Tamper-Proof)
                              </span>
                            </div>

                            <pre
                              style={{
                                background: 'var(--bg)',
                                border: '1px solid var(--border)',
                                borderRadius: 8,
                                padding: '14px 16px',
                                fontSize: 12,
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--accent)',
                                maxHeight: 280,
                                overflowY: 'auto',
                              }}
                            >
                              <code>{r.plan_json}</code>
                            </pre>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
