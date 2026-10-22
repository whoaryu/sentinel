import React, { useState, useEffect } from 'react';
import { Database, ShieldCheck, Search, ChevronRight, ChevronDown, CheckCircle2, XCircle, AlertTriangle, Code, Terminal } from 'lucide-react';
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

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="view-container">
      {/* View Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span className="badge-tag badge-accent">
            <Database size={11} /> SQLite Append-Only Storage
          </span>
          <span className="badge-tag">
            Engine: WAL Mode
          </span>
        </div>

        <h1>Immutable Audit Trail</h1>
        <p className="lead">
          Every proposed action plan, policy validation decision, and elevated execution outcome is permanently committed. SQL database triggers strictly prohibit UPDATE and DELETE operations.
        </p>
      </div>

      {/* Filter & Search Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div className="pills-container">
          {(['All', 'Executed', 'Denied', 'Simulated'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`pill-btn ${filter === tab ? 'active' : ''}`}
              onClick={() => setFilter(tab)}
              style={{
                backgroundColor: filter === tab ? 'var(--bg-surface-hover)' : undefined,
                color: filter === tab ? 'var(--fg-primary)' : undefined,
                borderColor: filter === tab ? 'var(--border-muted)' : undefined,
                fontWeight: filter === tab ? 600 : 500,
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', width: 260 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)' }} />
          <input
            type="text"
            className="input-field"
            placeholder="Search plans or keywords..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 30, fontSize: 12 }}
          />
        </div>
      </div>

      {/* Audit Table */}
      <div className="audit-table-wrapper">
        <table className="audit-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th>Plan ID</th>
              <th>Original Intent</th>
              <th>Status</th>
              <th>Actions</th>
              <th>Committed</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--fg-muted)' }}>
                  No audit trail records matching criteria.
                </td>
              </tr>
            ) : (
              filtered.map((record) => {
                const isExpanded = expandedId === record.id;
                const statusColor =
                  record.status === 'Executed'
                    ? 'badge-safe'
                    : record.status === 'Denied'
                    ? 'badge-danger'
                    : 'badge-warn';

                return (
                  <React.Fragment key={record.id}>
                    <tr onClick={() => toggleExpand(record.id)} style={{ cursor: 'pointer' }}>
                      <td>
                        {isExpanded ? <ChevronDown size={14} color="var(--fg-muted)" /> : <ChevronRight size={14} color="var(--fg-muted)" />}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--fg-primary)' }}>
                        {record.id.slice(0, 10)}
                      </td>
                      <td style={{ fontWeight: 500, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {record.request}
                      </td>
                      <td>
                        <span className={`badge-tag ${statusColor}`}>
                          {record.status}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>
                        {record.actions_count ?? 1} action(s)
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--fg-muted)' }}>
                        {new Date(record.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                        {new Date(record.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>

                    {/* Expandable JSON detail row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--bg-code)', padding: 18 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                                Raw Immutable Record (SQLite Payload)
                              </span>
                              <span className="badge-tag">
                                Trigger: no_update_plans
                              </span>
                            </div>

                            <pre
                              style={{
                                margin: 0,
                                padding: 14,
                                borderRadius: 'var(--radius-sm)',
                                background: 'var(--bg-canvas)',
                                border: '1px solid var(--border-hairline)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: 11.5,
                                color: 'var(--fg-primary)',
                                overflowX: 'auto',
                                maxHeight: 240,
                              }}
                            >
                              {record.plan_json}
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
