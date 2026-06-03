'use client';

import { useEffect, useState, useCallback } from 'react';
import { Shield, ChevronDown, ChevronUp, Check, Clock, AlertTriangle, Search, X, Download } from 'lucide-react';

interface ComplianceSession {
  SESSION_ID: string;
  APP_USER_ID: string;
  PHYSICIAN_ID: string;
  SESSION_START: string;
  SESSION_END: string;
  TOTAL_TURNS: number;
  FLAGGED_TURNS: number;
  BLOCKED_TURNS: number;
  REVIEWED_TURNS: number;
  FULLY_REVIEWED: boolean;
}

interface ComplianceTurn {
  LOG_ID: string;
  TURN_INDEX: number;
  SPEAKER: 'rep' | 'persona';
  RAW_TEXT: string;
  COMPLIANCE_FLAGS: any[] | null;
  OVERALL_STATUS: 'clean' | 'flagged' | 'blocked';
  TIMESTAMP_UTC: string;
  REVIEWED_BY: string | null;
  REVIEWED_AT: string | null;
}

export default function ComplianceDashboard({ onBack }: { onBack: () => void }) {
  const [sessions, setSessions] = useState<ComplianceSession[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [sessionTurns, setSessionTurns] = useState<Record<string, ComplianceTurn[]>>({});
  const [loadingTurns, setLoadingTurns] = useState<Record<string, boolean>>({});
  const [reviewingSession, setReviewingSession] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const PAGE_SIZE = 20;

  const loadSessions = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/compliance/sessions?page=${p}`);
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load');
      const data = await res.json();
      setSessions(data.sessions ?? []);
      setTotal(data.total ?? 0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(page); }, [page, loadSessions]);

  const toggleSession = async (sessionId: string) => {
    if (expandedSession === sessionId) {
      setExpandedSession(null);
      return;
    }
    setExpandedSession(sessionId);
    if (sessionTurns[sessionId]) return;
    setLoadingTurns(prev => ({ ...prev, [sessionId]: true }));
    try {
      const res = await fetch(`/api/compliance/sessions/${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      setSessionTurns(prev => ({ ...prev, [sessionId]: data.turns ?? [] }));
    } catch { /* silently fail */ } finally {
      setLoadingTurns(prev => ({ ...prev, [sessionId]: false }));
    }
  };

  const markReviewed = async (sessionId: string) => {
    setReviewingSession(sessionId);
    try {
      await fetch(`/api/compliance/sessions/${encodeURIComponent(sessionId)}/review`, { method: 'POST' });
      setSessions(prev => prev.map(s =>
        s.SESSION_ID === sessionId ? { ...s, FULLY_REVIEWED: true, REVIEWED_TURNS: s.TOTAL_TURNS } : s
      ));
    } catch { /* silently fail */ } finally {
      setReviewingSession(null);
    }
  };

  const statusBadge = (status: string) => {
    if (status === 'blocked')  return 'bg-red-100 text-red-700 border-red-200';
    if (status === 'flagged')  return 'bg-amber-100 text-amber-700 border-amber-200';
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  };

  const statusLabel = (status: string) => {
    if (status === 'blocked') return 'Blocked';
    if (status === 'flagged') return 'Flagged';
    return 'Clean';
  };

  const filtered = sessions.filter(s =>
    !search || s.APP_USER_ID.toLowerCase().includes(search.toLowerCase()) ||
    s.PHYSICIAN_ID?.toLowerCase().includes(search.toLowerCase()) ||
    s.SESSION_ID.toLowerCase().includes(search.toLowerCase())
  );

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const totalFlagged = sessions.filter(s => s.FLAGGED_TURNS > 0 || s.BLOCKED_TURNS > 0).length;
  const totalPendingReview = sessions.filter(s => !s.FULLY_REVIEWED).length;

  return (
    <div className="flex flex-col h-full bg-white min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-slate-100 shrink-0">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-slate-400" />
          <div>
            <p className="text-lg font-semibold text-slate-900">Compliance Audit</p>
            <p className="text-sm text-slate-400">Every session turn logged for review</p>
          </div>
        </div>
        <button onClick={onBack} className="text-sm text-slate-400 hover:text-slate-700 px-3 py-1 rounded-full hover:bg-slate-100 transition-colors">
          Back
        </button>
      </div>

      {/* Stats strip */}
      <div className="shrink-0 grid grid-cols-3 gap-4 px-6 py-4 border-b border-slate-100 bg-slate-50/50">
        {[
          { label: 'Total Sessions', value: total, icon: <Clock className="w-4 h-4" />, color: 'text-slate-600' },
          { label: 'Sessions with Flags', value: totalFlagged, icon: <AlertTriangle className="w-4 h-4" />, color: totalFlagged > 0 ? 'text-amber-600' : 'text-slate-600' },
          { label: 'Pending Review', value: totalPendingReview, icon: <Shield className="w-4 h-4" />, color: totalPendingReview > 0 ? 'text-blue-600' : 'text-emerald-600' },
        ].map(stat => (
          <div key={stat.label} className="bg-white rounded-xl border border-slate-100 px-4 py-3 flex items-center gap-3 shadow-sm">
            <span className={stat.color}>{stat.icon}</span>
            <div>
              <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-slate-400">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="shrink-0 px-6 py-3 border-b border-slate-100">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by user, physician, session ID…"
            className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-3 h-3" /></button>}
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading sessions…</div>
        )}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Shield className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm">No sessions logged yet</p>
            <p className="text-xs mt-1">Sessions will appear here once reps start practicing</p>
          </div>
        )}
        {!loading && filtered.map(s => {
          const isExpanded = expandedSession === s.SESSION_ID;
          const hasFlags = s.FLAGGED_TURNS > 0 || s.BLOCKED_TURNS > 0;
          const turns = sessionTurns[s.SESSION_ID] ?? [];
          const isLoadingTurns = loadingTurns[s.SESSION_ID];

          return (
            <div key={s.SESSION_ID} className="border-b border-slate-100 last:border-0">
              {/* Session row */}
              <div
                onClick={() => toggleSession(s.SESSION_ID)}
                className="flex items-center gap-4 px-6 py-3.5 hover:bg-slate-50 cursor-pointer transition-colors"
              >
                {/* Status dot */}
                <div className={`w-2 h-2 rounded-full shrink-0 ${hasFlags ? 'bg-amber-400' : 'bg-emerald-400'}`} />

                {/* Session info */}
                <div className="flex-1 min-w-0 grid grid-cols-4 gap-4 items-center">
                  <div>
                    <p className="text-sm font-medium text-slate-800 truncate">{s.APP_USER_ID}</p>
                    <p className="text-xs text-slate-400 truncate">{s.PHYSICIAN_ID || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">{new Date(s.SESSION_START).toLocaleString()}</p>
                    <p className="text-xs text-slate-400">{s.TOTAL_TURNS} turns</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {hasFlags ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                        <AlertTriangle className="w-3 h-3" />{s.FLAGGED_TURNS + s.BLOCKED_TURNS} flag{s.FLAGGED_TURNS + s.BLOCKED_TURNS !== 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-emerald-600 font-medium">✓ Clean</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {s.FULLY_REVIEWED ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                        <Check className="w-3 h-3" /> Reviewed
                      </span>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); markReviewed(s.SESSION_ID); }}
                        disabled={reviewingSession === s.SESSION_ID}
                        className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                      >
                        {reviewingSession === s.SESSION_ID ? 'Marking…' : 'Mark reviewed'}
                      </button>
                    )}
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
                  </div>
                </div>
              </div>

              {/* Expanded turns */}
              {isExpanded && (
                <div className="bg-slate-50 border-t border-slate-100 px-6 pb-4 pt-2">
                  {isLoadingTurns && <p className="text-xs text-slate-400 py-3">Loading turns…</p>}
                  {!isLoadingTurns && turns.length === 0 && <p className="text-xs text-slate-400 py-3">No turns recorded for this session.</p>}
                  <div className="space-y-2 mt-2">
                    {turns.map(t => (
                      <div key={t.LOG_ID} className={`rounded-lg border px-4 py-3 text-sm ${statusBadge(t.OVERALL_STATUS)}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-semibold uppercase tracking-widest ${t.SPEAKER === 'rep' ? 'text-blue-600' : 'text-violet-600'}`}>
                              {t.SPEAKER === 'rep' ? 'Rep' : 'Persona'}
                            </span>
                            <span className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${statusBadge(t.OVERALL_STATUS)}`}>
                              {statusLabel(t.OVERALL_STATUS)}
                            </span>
                          </div>
                          <span className="text-xs text-slate-400">{new Date(t.TIMESTAMP_UTC).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-slate-700 leading-relaxed text-sm">{t.RAW_TEXT}</p>
                        {t.COMPLIANCE_FLAGS && Array.isArray(t.COMPLIANCE_FLAGS) && t.COMPLIANCE_FLAGS.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {t.COMPLIANCE_FLAGS.map((f: any, i: number) => (
                              <span key={i} className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                                {f.rule_code ?? f}
                              </span>
                            ))}
                          </div>
                        )}
                        {t.REVIEWED_BY && (
                          <p className="mt-1.5 text-xs text-slate-400">Reviewed by {t.REVIEWED_BY}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-center gap-3 px-6 py-3 border-t border-slate-100">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1 text-sm rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-colors">
            ← Prev
          </button>
          <span className="text-sm text-slate-500">Page {page} of {totalPages}</span>
          <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1 text-sm rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50 transition-colors">
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
