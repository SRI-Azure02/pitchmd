'use client';

import React, { useEffect, useState } from 'react';
import {
  ArrowDown, ArrowUp, ArrowUpDown, BookOpen, ChevronDown, ChevronUp,
  Search, X, RefreshCw, AlertCircle,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Physician {
  PHYSICIAN_ID: string;
  FIRST_NAME: string;
  LAST_NAME: string;
  SPECIALTY: string | null;
  SEGMENT_NAME: string | null;
  STATE: string | null;
  OVERALL_SCORE: number | null;
  FIELD_READINESS: string | null;
}

interface Objection {
  objection: string;
  suggested_response: string;
}

interface PlaybookJSON {
  rep_brief: string;
  opening_strategy: string;
  key_messages: string[];
  anticipated_objections: Objection[];
  closing_ask: string;
  follow_up_items: string[];
  tone_guidance: string;
}

interface PhysicianPlaybookState {
  status: 'idle' | 'loading' | 'done' | 'error';
  playbook: PlaybookJSON | null;
  error: string | null;
}

type SortField = 'name' | 'specialty' | 'segment' | 'state' | 'overallScore' | 'fieldReadiness';
type SortDir   = 'asc' | 'desc';

// ── Helpers ────────────────────────────────────────────────────────────────────

function readinessBadge(val: string): React.CSSProperties {
  if (val === 'Field Ready')             return { background: '#d1fae5', color: '#065f46' };
  if (val === 'Not Ready')               return { background: '#fee2e2', color: '#991b1b' };
  if (val === 'Field Ready with coaching') return { background: '#fef3c7', color: '#92400e' };
  if (val === 'Needs Practice')          return { background: '#ffe4e6', color: '#9f1239' };
  return { background: '#f1f5f9', color: '#475569' };
}

// ── Section component ──────────────────────────────────────────────────────────

function PlaybookSection({ label, children, last = false }: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`${last ? '' : 'pb-4 border-b border-slate-100 mb-4'}`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">{label}</p>
      {children}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface EngagementPlaybookProps {
  username: string;
  onBack: () => void;
}

export default function EngagementPlaybook({ username: _username, onBack }: EngagementPlaybookProps) {
  const [physicians, setPhysicians]         = useState<Physician[]>([]);
  const [physLoading, setPhysLoading]       = useState(true);
  const [expandedId, setExpandedId]         = useState<string | null>(null);
  const [search, setSearch]                 = useState('');
  const [sortConfig, setSortConfig]         = useState<{ field: SortField; dir: SortDir } | null>(null);
  const [playbookStates, setPlaybookStates] = useState<Record<string, PhysicianPlaybookState>>({});
  const [hoveredBtnId, setHoveredBtnId]     = useState<string | null>(null);

  // Load physicians
  useEffect(() => {
    fetch('/api/physicians?scores=true')
      .then(r => r.json())
      .then(d => setPhysicians(d.physicians ?? d ?? []))
      .catch(console.error)
      .finally(() => setPhysLoading(false));
  }, []);

  // Sort / filter
  const handleSort = (field: SortField) => {
    setSortConfig(prev =>
      prev?.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' }
    );
  };

  const sortedPhysicians = [...physicians]
    .filter(p => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        p.FIRST_NAME?.toLowerCase().includes(q) ||
        p.LAST_NAME?.toLowerCase().includes(q) ||
        p.SPECIALTY?.toLowerCase().includes(q) ||
        p.SEGMENT_NAME?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (!sortConfig) return 0;
      const dir = sortConfig.dir === 'asc' ? 1 : -1;
      switch (sortConfig.field) {
        case 'name':           return dir * `${a.LAST_NAME}${a.FIRST_NAME}`.localeCompare(`${b.LAST_NAME}${b.FIRST_NAME}`);
        case 'specialty':      return dir * (a.SPECIALTY ?? '').localeCompare(b.SPECIALTY ?? '');
        case 'segment':        return dir * (a.SEGMENT_NAME ?? '').localeCompare(b.SEGMENT_NAME ?? '');
        case 'state':          return dir * (a.STATE ?? '').localeCompare(b.STATE ?? '');
        case 'overallScore':   return dir * ((a.OVERALL_SCORE ?? 0) - (b.OVERALL_SCORE ?? 0));
        case 'fieldReadiness': return dir * (a.FIELD_READINESS ?? '').localeCompare(b.FIELD_READINESS ?? '');
        default:               return 0;
      }
    });

  // Sort icon
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortConfig?.field !== field)
      return <ArrowUpDown className="w-3 h-3 opacity-0 group-hover/th:opacity-40 transition-opacity" />;
    return sortConfig.dir === 'asc'
      ? <ArrowUp className="w-3 h-3" />
      : <ArrowDown className="w-3 h-3" />;
  };

  // Fetch / cache playbook
  const handleViewPlaybook = async (physicianId: string) => {
    const current = playbookStates[physicianId];
    // Toggle collapse if already loaded and expanded
    if (expandedId === physicianId && current?.status === 'done') {
      setExpandedId(null);
      return;
    }
    setExpandedId(physicianId);
    // Use cache if available
    if (current?.status === 'done') return;
    // Start loading
    setPlaybookStates(prev => ({
      ...prev,
      [physicianId]: { status: 'loading', playbook: null, error: null },
    }));
    try {
      const res = await fetch('/api/playbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ physicianId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPlaybookStates(prev => ({
        ...prev,
        [physicianId]: { status: 'done', playbook: data.playbook, error: null },
      }));
    } catch (err: any) {
      setPlaybookStates(prev => ({
        ...prev,
        [physicianId]: { status: 'error', playbook: null, error: err.message },
      }));
    }
  };

  const handleRetry = (physicianId: string) => {
    setPlaybookStates(prev => ({
      ...prev,
      [physicianId]: { status: 'idle', playbook: null, error: null },
    }));
    handleViewPlaybook(physicianId);
  };

  // Render playbook content
  const renderPlaybookContent = (physicianId: string) => {
    const state = playbookStates[physicianId];
    if (!state || state.status === 'idle') return null;

    if (state.status === 'loading') {
      return (
        <div className="flex items-center justify-center gap-2.5 py-8 text-slate-400">
          <Spinner className="w-4 h-4" />
          <span className="text-sm">Generating your playbook…</span>
        </div>
      );
    }

    if (state.status === 'error') {
      return (
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="flex items-center gap-2 text-red-500 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{state.error ?? 'Failed to generate playbook'}</span>
          </div>
          <button
            onClick={() => handleRetry(physicianId)}
            className="flex items-center gap-1.5 h-8 px-4 rounded-full text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      );
    }

    const pb = state.playbook!;

    return (
      <div className="space-y-0">
        {/* Rep Brief */}
        <PlaybookSection label="Rep Brief">
          <p className="text-sm text-slate-700 leading-relaxed">{pb.rep_brief}</p>
        </PlaybookSection>

        {/* Opening Strategy */}
        <PlaybookSection label="Opening Strategy">
          <p className="text-sm text-slate-700 leading-relaxed">{pb.opening_strategy}</p>
        </PlaybookSection>

        {/* Key Messages */}
        <PlaybookSection label="Key Messages">
          <ul className="space-y-1.5">
            {(pb.key_messages ?? []).map((msg, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                {msg}
              </li>
            ))}
          </ul>
        </PlaybookSection>

        {/* Anticipated Objections */}
        <PlaybookSection label="Anticipated Objections">
          <div className="space-y-3">
            {(pb.anticipated_objections ?? []).map((obj, i) => (
              <div key={i} className="rounded-lg border border-slate-200 bg-white p-3 space-y-1.5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Objection</p>
                <p className="text-sm text-slate-700">{obj.objection}</p>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide pt-1">Suggested Response</p>
                <p className="text-sm text-slate-600 italic">"{obj.suggested_response}"</p>
              </div>
            ))}
          </div>
        </PlaybookSection>

        {/* Closing Ask */}
        <PlaybookSection label="Closing Ask">
          <p className="text-sm text-slate-700 leading-relaxed">{pb.closing_ask}</p>
        </PlaybookSection>

        {/* Follow-Up Items */}
        <PlaybookSection label="Follow-Up Items">
          {(pb.follow_up_items ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">No open follow-up items.</p>
          ) : (
            <ul className="space-y-1.5">
              {pb.follow_up_items.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          )}
        </PlaybookSection>

        {/* Tone Guidance */}
        <PlaybookSection label="Tone & Approach" last>
          <p className="text-sm text-slate-700 leading-relaxed">{pb.tone_guidance}</p>
        </PlaybookSection>
      </div>
    );
  };

  const columns: { label: string; field: SortField; align: 'left' | 'center' }[] = [
    { label: 'Physician',  field: 'name',           align: 'left'   },
    { label: 'Specialty',  field: 'specialty',      align: 'left'   },
    { label: 'Segment',    field: 'segment',        align: 'left'   },
    { label: 'State',      field: 'state',          align: 'left'   },
    { label: 'Score',      field: 'overallScore',   align: 'center' },
    { label: 'Readiness',  field: 'fieldReadiness', align: 'left'   },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100 bg-white shrink-0">
        <div>
          <p className="text-lg font-semibold text-slate-900">Engagement Playbook</p>
          <p className="text-sm text-slate-400">AI-powered pre-call brief for every physician visit</p>
        </div>
        <button
          onClick={onBack}
          className="text-sm text-slate-400 hover:text-slate-700 px-3 py-1 rounded-full hover:bg-slate-100 transition-colors"
        >
          Back
        </button>
      </div>

      {/* ── Search bar ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search physicians…"
              className="w-full pl-8 pr-3 py-1.5 rounded-full border border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <p className="text-xs text-slate-400">
            {sortedPhysicians.length} of {physicians.length} physician{physicians.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {physLoading ? (
          <div className="flex items-center justify-center h-40 gap-2 text-slate-400">
            <Spinner className="w-4 h-4" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : (
          <table className="w-full text-base border-collapse min-w-[780px]">
            <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_#e2e8f0]">
              <tr>
                {columns.map(({ label, field, align }) => (
                  <th
                    key={field}
                    onClick={() => handleSort(field)}
                    className="group/th px-4 py-2.5 text-sm font-semibold uppercase tracking-wide cursor-pointer select-none transition-colors"
                    style={{ textAlign: align }}
                  >
                    <span
                      className={`inline-flex items-center gap-1 group-hover/th:text-slate-600 ${align === 'center' ? 'justify-center w-full' : ''}`}
                      style={{ color: sortConfig?.field === field ? '#3b82f6' : '#94a3b8' }}
                    >
                      {label}
                      <SortIcon field={field} />
                    </span>
                  </th>
                ))}
                {/* Sticky actions column */}
                <th className="sticky right-0 bg-white px-4 py-2.5 text-sm font-semibold uppercase tracking-wide shadow-[-1px_0_0_0_#e2e8f0] text-right">
                  <span className="text-slate-400"></span>
                </th>
              </tr>
            </thead>

            <tbody>
              {sortedPhysicians.map(p => {
                const expanded     = expandedId === p.PHYSICIAN_ID;
                const pbState      = playbookStates[p.PHYSICIAN_ID];
                const isLoading    = pbState?.status === 'loading';
                const btnLabel     = isLoading ? 'Generating…' : (expanded && pbState?.status === 'done') ? 'Close' : 'View Playbook';
                const isHovered    = hoveredBtnId === p.PHYSICIAN_ID;

                return (
                  <React.Fragment key={p.PHYSICIAN_ID}>
                    <tr className="group border-b border-slate-100 hover:bg-slate-100/70 transition-colors">
                      {/* Physician name */}
                      <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                        <span className="flex items-center gap-2">
                          {expanded
                            ? <ChevronUp   className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            : <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                          Dr. {p.FIRST_NAME} {p.LAST_NAME}
                        </span>
                      </td>

                      {/* Specialty */}
                      <td className="px-4 py-3 text-slate-600">
                        {p.SPECIALTY ?? <span className="text-slate-300">—</span>}
                      </td>

                      {/* Segment */}
                      <td className="px-4 py-3 text-slate-600">
                        {p.SEGMENT_NAME ?? <span className="text-slate-300">—</span>}
                      </td>

                      {/* State */}
                      <td className="px-4 py-3 text-slate-600">
                        {p.STATE ?? <span className="text-slate-300">—</span>}
                      </td>

                      {/* Score */}
                      <td className="px-4 py-3 text-center">
                        {p.OVERALL_SCORE != null
                          ? <span className="font-semibold text-slate-700">{Number(p.OVERALL_SCORE).toFixed(1)}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>

                      {/* Readiness */}
                      <td className="px-4 py-3">
                        {p.FIELD_READINESS ? (
                          <span
                            className="inline-block text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
                            style={readinessBadge(p.FIELD_READINESS)}
                          >
                            {p.FIELD_READINESS}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* Sticky action column */}
                      <td className="sticky right-0 bg-white group-hover:bg-slate-100/70 px-4 py-3 shadow-[-1px_0_0_0_#e2e8f0] transition-colors text-right">
                        <button
                          onClick={() => handleViewPlaybook(p.PHYSICIAN_ID)}
                          disabled={isLoading}
                          onMouseEnter={() => setHoveredBtnId(p.PHYSICIAN_ID)}
                          onMouseLeave={() => setHoveredBtnId(null)}
                          className="h-9 px-4 rounded-full inline-flex items-center gap-2 border border-slate-200 bg-white text-slate-500 text-sm font-medium hover:text-white hover:border-transparent transition-all whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
                          style={isHovered && !isLoading ? { background: 'linear-gradient(135deg,#FF6B00,#00C8FF)', color: '#fff', borderColor: 'transparent' } : {}}
                        >
                          {isLoading
                            ? <><Spinner className="w-3.5 h-3.5 shrink-0" />{btnLabel}</>
                            : <><BookOpen className="w-3.5 h-3.5 shrink-0" />{btnLabel}</>
                          }
                        </button>
                      </td>
                    </tr>

                    {/* ── Accordion playbook panel ─────────────────────────── */}
                    {expanded && (
                      <tr className="border-b border-slate-200">
                        <td colSpan={7} className="p-0">
                          <div className="bg-slate-50 px-6 py-5">
                            {renderPlaybookContent(p.PHYSICIAN_ID)}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {sortedPhysicians.length === 0 && !physLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">
                    No physicians match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
