'use client';

import React, { useState } from 'react';
import { usePhysicianList } from '@/lib/hooks/use-physician-list';
import { Paginator } from '@/components/ui/paginator';
import { parseSnowflakeDate } from '@/lib/dates';
import {
  ArrowDown, ArrowUp, ArrowUpDown, BookOpen, Check, ChevronDown, ChevronUp,
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
  LAST_CONTACT_DATE: string | null;
  LAST_CONTACT_CHANNEL: string | null;
}

interface PlaybookJSON {
  physician_brief: string;
  opening_points: string[];
  key_messages: string[];
  anticipated_objections: { objection: string; responses: string[] }[];
  closing_ask: string;
}

interface BrandShare {
  brand: string;
  current_share: number;
  direction: 'up' | 'down' | 'flat';
  change: number;
}

interface PhysicianPlaybookState {
  status: 'idle' | 'loading' | 'done' | 'error';
  playbook: PlaybookJSON | null;
  marketShare: BrandShare[] | null;
  openTasks: string[];
  error: string | null;
}

type SortField = 'name' | 'specialty' | 'segment' | 'state' | 'lastContact';
type SortDir   = 'asc' | 'desc';

// ── Filter dropdown ────────────────────────────────────────────────────────────

function FilterDropdown({ label, options, value, onChange, isOpen, onToggle }: {
  label: string;
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const active = !!value;
  return (
    <div className="relative">
      {isOpen && <div className="fixed inset-0 z-40" onClick={onToggle} />}
      <button
        onClick={onToggle}
        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${
          active
            ? 'border-orange-300 bg-orange-50 text-orange-700'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        {label}
        {active && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 ml-0.5" />}
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg min-w-max py-1 overflow-hidden">
          <button
            onClick={() => { onChange(null); onToggle(); }}
            className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-slate-50 ${!value ? 'text-orange-600 font-medium' : 'text-slate-600'}`}
          >
            <span className="whitespace-nowrap">All</span>
            {!value && <Check className="w-3.5 h-3.5 ml-4" />}
          </button>
          {options.map(opt => (
            <button
              key={opt}
              onClick={() => { onChange(opt); onToggle(); }}
              className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-slate-50 ${value === opt ? 'text-orange-600 font-medium bg-orange-50' : 'text-slate-600'}`}
            >
              <span className="whitespace-nowrap">{opt}</span>
              {value === opt && <Check className="w-3.5 h-3.5 ml-4 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Playbook card ──────────────────────────────────────────────────────────────

function PbCard({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col ${className}`}>
      <div className="px-4 py-2 border-b border-slate-100 bg-white shrink-0">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#2B5FA6' }}>{label}</span>
      </div>
      <div className="px-4 py-3 flex-1">{children}</div>
    </div>
  );
}

function Bullets({ items, color = 'bg-orange-400' }: { items: string[]; color?: string }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
          <span className={`mt-[7px] w-1.5 h-1.5 rounded-full ${color} shrink-0`} />
          {item}
        </li>
      ))}
    </ul>
  );
}

// ── Channel display helper ─────────────────────────────────────────────────────

function channelLabel(raw: string | null): string {
  if (!raw) return '—';
  const r = raw.toLowerCase();
  if (r.includes('face')) return 'Face to Face';
  if (r.includes('teleph')) return 'Telephonic';
  if (r.includes('email')) return 'Email';
  return raw;
}

function formatDate(raw: string | null): string {
  if (!raw) return '—';
  const d = parseSnowflakeDate(raw);
  if (!d) return String(raw);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Main component ─────────────────────────────────────────────────────────────

interface EngagementPlaybookProps {
  username: string;
  onBack: () => void;
}

export default function EngagementPlaybook({ username: _username, onBack }: EngagementPlaybookProps) {
  const hook = usePhysicianList();
  const [expandedId, setExpandedId]         = useState<string | null>(null);
  const [tasksExpandedId, setTasksExpandedId] = useState<string | null>(null);
  const [sortConfig, setSortConfig]         = useState<{ field: SortField; dir: SortDir } | null>(null);
  const [playbookStates, setPlaybookStates] = useState<Record<string, PhysicianPlaybookState>>({});
  const [hoveredBtnId, setHoveredBtnId]     = useState<string | null>(null);
  const [openDropdown, setOpenDropdown]     = useState<string | null>(null);

  const uniqueSegments    = hook.filterOptions.segments;
  const uniqueSpecialties = hook.filterOptions.specialties;

  const SERVER_SORT_FIELDS = new Set<SortField>(['name', 'specialty', 'segment', 'state', 'lastContact']);
  const handleSort = (field: SortField) => {
    setSortConfig(prev => {
      const newDir: SortDir = prev?.field === field && prev.dir === 'asc' ? 'desc' : 'asc';
      if (SERVER_SORT_FIELDS.has(field)) hook.setSort(field, newDir);
      return { field, dir: newDir };
    });
  };

  // search / segment / specialty / sort are all handled server-side via hook
  const sortedPhysicians = hook.physicians;

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortConfig?.field !== field)
      return <ArrowUpDown className="w-3 h-3 opacity-0 group-hover/th:opacity-40 transition-opacity" />;
    return sortConfig.dir === 'asc'
      ? <ArrowUp className="w-3 h-3" />
      : <ArrowDown className="w-3 h-3" />;
  };

  const handleViewPlaybook = async (physicianId: string) => {
    const current = playbookStates[physicianId];
    if (expandedId === physicianId && current?.status === 'done') {
      setExpandedId(null);
      return;
    }
    setExpandedId(physicianId);
    if (current?.status === 'done') return;
    setPlaybookStates(prev => ({
      ...prev,
      [physicianId]: { status: 'loading', playbook: null, marketShare: null, openTasks: [], error: null },
    }));
    try {
      const res = await fetch('/api/playbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ physicianId }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPlaybookStates(prev => ({
        ...prev,
        [physicianId]: {
          status: 'done',
          playbook: data.playbook,
          marketShare: data.marketShare ?? [],
          openTasks: data.openTasks ?? [],
          error: null,
        },
      }));
    } catch (err: any) {
      setPlaybookStates(prev => ({
        ...prev,
        [physicianId]: { status: 'error', playbook: null, marketShare: null, openTasks: [], error: err.message },
      }));
    }
  };

  const handleRetry = (physicianId: string) => {
    setPlaybookStates(prev => ({
      ...prev,
      [physicianId]: { status: 'idle', playbook: null, marketShare: null, openTasks: [], error: null },
    }));
    handleViewPlaybook(physicianId);
  };

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
    const ms = state.marketShare ?? [];
    const tasks = state.openTasks ?? [];
    const physician = hook.physicians.find(ph => ph.PHYSICIAN_ID === physicianId);
    const tasksExpanded = tasksExpandedId === physicianId;

    return (
      <div className="space-y-3">

        {/* ── Row 1: Summary — full width ─────────────────────────────────── */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 pt-3 pb-2.5 bg-white border-b border-slate-100">
            {physician?.SEGMENT_NAME && (
              <span className="inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full bg-orange-100 text-orange-700 mb-1.5">
                {physician.SEGMENT_NAME}
              </span>
            )}
            <p className="text-sm text-slate-700">{pb.physician_brief}</p>
          </div>
          {ms.length > 0 && (
            <div className="px-4 py-3 bg-white space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Market Share — last 4 weeks</p>
              {ms.map(b => (
                <div key={b.brand} className="flex items-center gap-2.5">
                  <span className="text-xs font-medium text-slate-600 w-20 shrink-0 truncate">{b.brand}</span>
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-orange-400 to-sky-400"
                      style={{ width: `${Math.min(b.current_share, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-700 w-10 text-right">{b.current_share}%</span>
                  <span className={`text-xs font-medium w-14 text-right tabular-nums ${
                    b.direction === 'up' ? 'text-emerald-600' :
                    b.direction === 'down' ? 'text-red-500' : 'text-slate-400'
                  }`}>
                    {b.direction === 'up' ? '↑' : b.direction === 'down' ? '↓' : '→'}{' '}
                    {b.direction === 'flat' ? 'flat' : `${b.change}pp`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Row 2: Two-column grid — equal height ───────────────────────── */}
        <div className="grid grid-cols-2 gap-3" style={{ alignItems: 'stretch' }}>
          {/* Left column */}
          <div className="flex flex-col gap-3">
            <PbCard label="Opening" className="flex-1">
              <Bullets items={pb.opening_points ?? []} color="bg-orange-400" />
            </PbCard>
            <PbCard label="Key Messages" className="flex-1">
              <Bullets items={pb.key_messages ?? []} color="bg-sky-400" />
            </PbCard>
          </div>

          {/* Right column — full height */}
          <PbCard label="Objection Handling" className="h-full">
            <div className="space-y-3">
              {(pb.anticipated_objections ?? []).map((obj, i) => (
                <div key={i} className={i > 0 ? 'pt-3 border-t border-slate-100' : ''}>
                  <p className="text-sm font-semibold text-slate-700 mb-1.5">{obj.objection}</p>
                  <Bullets items={obj.responses ?? []} color="bg-slate-300" />
                </div>
              ))}
            </div>
          </PbCard>
        </div>

        {/* ── Row 3: Closing — full width ─────────────────────────────────── */}
        <PbCard label="Closing">
          <p className="text-sm text-slate-700">{pb.closing_ask}</p>
        </PbCard>

        {/* ── Row 4: Open Tasks — collapsible, collapsed by default ────────── */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <button
            onClick={() => setTasksExpandedId(tasksExpanded ? null : physicianId)}
            className="w-full flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/60 hover:bg-slate-100/60 transition-colors"
          >
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Pending Tasks
              {tasks.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full bg-orange-100 text-orange-600 text-[10px] font-bold normal-case tracking-normal">
                  {tasks.length}
                </span>
              )}
            </span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke={tasksExpanded ? '#2B5FA6' : '#cbd5e1'}
              strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points={tasksExpanded ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
            </svg>
          </button>
          {tasksExpanded && (
            <div className="px-4 py-3">
              {tasks.length === 0 ? (
                <p className="text-sm text-slate-400">No open tasks for this physician.</p>
              ) : (
                <Bullets items={tasks} color="bg-orange-400" />
              )}
            </div>
          )}
        </div>

      </div>
    );
  };

  const columns: { label: string; field: SortField; align: 'left' }[] = [
    { label: 'Physician',     field: 'name',        align: 'left' },
    { label: 'Specialty',     field: 'specialty',   align: 'left' },
    { label: 'Segment',       field: 'segment',     align: 'left' },
    { label: 'State',         field: 'state',       align: 'left' },
    { label: 'Last Contact',  field: 'lastContact', align: 'left' },
  ];

  const hasActiveFilters = hook.search || hook.filterSegment || hook.filterSpecialty;

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100 bg-white shrink-0">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#2B5FA6' }}>In-field</span>
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

      {/* ── Search + filter bar ─────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search input */}
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={hook.search}
              onChange={e => hook.setSearch(e.target.value)}
              placeholder="Search physicians…"
              className="w-full pl-8 pr-3 py-1.5 rounded-full border border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300"
            />
            {hook.search && (
              <button
                onClick={() => hook.setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Segment filter */}
          <FilterDropdown
            label="Segment"
            options={uniqueSegments}
            value={hook.filterSegment}
            onChange={hook.setFilterSegment}
            isOpen={openDropdown === 'segment'}
            onToggle={() => setOpenDropdown(prev => prev === 'segment' ? null : 'segment')}
          />

          {/* Specialty filter */}
          <FilterDropdown
            label="Specialty"
            options={uniqueSpecialties}
            value={hook.filterSpecialty}
            onChange={hook.setFilterSpecialty}
            isOpen={openDropdown === 'specialty'}
            onToggle={() => setOpenDropdown(prev => prev === 'specialty' ? null : 'specialty')}
          />

          {/* Clear filters */}
          {hasActiveFilters && (
            <button
              onClick={() => { hook.setSearch(''); hook.setFilterSegment(null); hook.setFilterSpecialty(null); }}
              className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded-full hover:bg-slate-100 transition-colors"
            >
              Clear filters
            </button>
          )}

          <p className="text-xs text-slate-400 ml-auto">
            {hook.totalCount} physician{hook.totalCount !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {hook.loading ? (
          <div className="flex items-center justify-center h-40 gap-2 text-slate-400">
            <Spinner className="w-4 h-4" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : (
          <table className="w-full text-base border-collapse min-w-[860px]">
            <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_#e2e8f0]">
              <tr>
                {columns.map(({ label, field }) => (
                  <th
                    key={field}
                    onClick={() => handleSort(field)}
                    className="group/th px-4 py-2.5 text-left text-sm font-semibold uppercase tracking-wide cursor-pointer select-none transition-colors"
                  >
                    <span
                      className="inline-flex items-center gap-1 group-hover/th:text-slate-600"
                      style={{ color: sortConfig?.field === field ? '#3b82f6' : '#94a3b8' }}
                    >
                      {label}
                      <SortIcon field={field} />
                    </span>
                  </th>
                ))}
                <th className="sticky right-0 bg-white px-4 py-2.5 text-sm font-semibold uppercase tracking-wide shadow-[-1px_0_0_0_#e2e8f0] text-right">
                  <span className="text-slate-400"></span>
                </th>
              </tr>
            </thead>

            <tbody>
              {sortedPhysicians.map(p => {
                const expanded  = expandedId === p.PHYSICIAN_ID;
                const pbState   = playbookStates[p.PHYSICIAN_ID];
                const isLoading = pbState?.status === 'loading';
                const btnLabel  = isLoading ? 'Generating…' : (expanded && pbState?.status === 'done') ? 'Close' : 'View Playbook';
                const isHovered = hoveredBtnId === p.PHYSICIAN_ID;

                return (
                  <React.Fragment key={p.PHYSICIAN_ID}>
                    <tr className="group border-b border-slate-100 hover:bg-slate-100/70 transition-colors">
                      {/* Physician name */}
                      <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                        <span className="flex items-center gap-2">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                            stroke={expanded ? '#2B5FA6' : '#cbd5e1'}
                            strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                            className="shrink-0">
                            <polyline points={expanded ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
                          </svg>
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
                      {/* Last Contact */}
                      <td className="px-4 py-3">
                        {p.LAST_CONTACT_DATE ? (
                          <div>
                            <p className="text-sm text-slate-700">{formatDate(p.LAST_CONTACT_DATE)}</p>
                            <p className="text-xs text-slate-400">{channelLabel(p.LAST_CONTACT_CHANNEL)}</p>
                          </div>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      {/* Action */}
                      <td className="sticky right-0 bg-white group-hover:bg-slate-100/70 px-4 py-3 shadow-[-1px_0_0_0_#e2e8f0] transition-colors text-right">
                        <button
                          onClick={() => handleViewPlaybook(p.PHYSICIAN_ID)}
                          disabled={isLoading}
                          onMouseEnter={() => setHoveredBtnId(p.PHYSICIAN_ID)}
                          onMouseLeave={() => setHoveredBtnId(null)}
                          className="h-9 w-[160px] justify-center rounded-full inline-flex items-center gap-2 border border-slate-200 bg-white text-slate-500 text-sm font-medium hover:text-white hover:border-transparent transition-all whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
                          style={isHovered && !isLoading ? { background: 'linear-gradient(135deg,#FF6B00,#00C8FF)', color: '#fff', borderColor: 'transparent' } : {}}
                        >
                          {isLoading
                            ? <><Spinner className="w-3.5 h-3.5 shrink-0" />{btnLabel}</>
                            : <><BookOpen className="w-3.5 h-3.5 shrink-0" />{btnLabel}</>
                          }
                        </button>
                      </td>
                    </tr>

                    {/* Accordion playbook panel */}
                    {expanded && (
                      <tr className="border-b border-slate-200">
                        <td colSpan={6} className="p-0">
                          <div className="px-6 py-5" style={{ backgroundColor: '#F1EFE9' }}>
                            {renderPlaybookContent(p.PHYSICIAN_ID)}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {sortedPhysicians.length === 0 && !hook.loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">
                    No physicians match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <Paginator
        page={hook.page}
        pageSize={hook.pageSize}
        total={hook.totalCount}
        onPageChange={hook.setPage}
      />
    </div>
  );
}
