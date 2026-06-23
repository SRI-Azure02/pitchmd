'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { HelpCircle, ChevronDown, ArrowUp, X, SquarePen, Trash2 } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

type OutputType = 'table' | 'chart' | 'stat';

interface ChartConfig {
  xKey: string;
  yKeys: { key: string; label: string }[];
  seriesKey?: string;
  title: string;
  yUnit?: string;
}

interface StatConfig {
  valueKey: string;
  label: string;
  trendKey?: string;
}

interface IMessage {
  id: string;
  query: string;
  outputType: OutputType | null;
  columns: string[];
  rows: any[];
  chartConfig: ChartConfig | null;
  statConfig: StatConfig | null;
  narrative: string;
  loading: boolean;
  error: string | null;
  isBlocked?: boolean;
}

interface DisambiguateState {
  candidates: {
    physicianId: string;
    firstName: string;
    lastName: string;
    specialty: string;
    city: string;
  }[];
  originalQuery: string;
  pendingMsgId: string;
}

interface ISession {
  id: string;
  title: string;
  createdAt: number;
  messages: IMessage[];
}

interface IntelligenceDrawerProps {
  open: boolean;
  onClose: () => void;
}

// ── Colours for chart lines ───────────────────────────────────────────────────

const LINE_COLOURS = ['#4f7eff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

// Snowflake DATE columns come back as integer epoch-days via the REST API.
// Convert to MM/DD/YY; also handles YYYY-MM-DD strings.
// Replace epoch-day numbers (10957–21915 covers 2000–2030) with MM/DD/YY
function replaceEpochDays(text: string): string {
  return text.replace(/\b(1[0-9]{4}|2[01][0-9]{3})\b/g, (match) => {
    const n = parseInt(match, 10);
    if (n >= 10957 && n <= 21915) return formatDateValue(n);
    return match;
  });
}

// Returns { heading, body } — heading is the first markdown heading line if present
function parseNarrative(raw: string): { heading: string | null; body: string } {
  const cleaned = raw
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ');

  const headingMatch = cleaned.match(/^#{1,6}\s+(.+)/m);
  if (headingMatch) {
    const heading = headingMatch[1].trim();
    const body = cleaned.replace(/^#{1,6}\s+.+\n?/m, '').trim();
    return { heading: replaceEpochDays(heading), body: replaceEpochDays(body) };
  }
  return { heading: null, body: replaceEpochDays(cleaned.trim()) };
}

function formatDateValue(val: any): string {
  // Snowflake REST API returns DATE as integer epoch-days, sometimes as a string.
  const asNum = typeof val === 'number' ? val : Number(val);
  if (!isNaN(asNum) && asNum > 10000 && asNum < 100000) {
    const d = new Date(asNum * 86400000);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const yy = String(d.getUTCFullYear()).slice(-2);
    return `${mm}/${dd}/${yy}`;
  }
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split('-');
    return `${m}/${d}/${y.slice(-2)}`;
  }
  return String(val ?? '');
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ rows, config }: { rows: any[]; config: StatConfig }) {
  if (rows.length === 0) return <p style={{ color: '#94a3b8', fontSize: 13 }}>No data.</p>;
  const row = rows[0];
  const value = row[config.valueKey] ?? row[config.valueKey.toUpperCase()];
  const trend = config.trendKey ? (row[config.trendKey] ?? row[config.trendKey.toUpperCase()]) : undefined;

  return (
    <div style={{
      display: 'inline-flex',
      flexDirection: 'column',
      gap: 4,
      background: '#ffffff',
      borderRadius: 12,
      padding: '16px 24px',
      border: '1px solid #e2e8f0',
      minWidth: 160,
    }}>
      <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{config.label}</span>
      <span style={{ fontSize: 32, fontWeight: 700, color: '#0f172a', lineHeight: 1.1 }}>
        {value != null ? String(value) : '—'}
      </span>
      {trend != null && (
        <span style={{ fontSize: 12, color: Number(trend) >= 0 ? '#10b981' : '#ef4444' }}>
          {Number(trend) >= 0 ? '▲' : '▼'} {String(trend)}
        </span>
      )}
    </div>
  );
}

function DataTable({ columns, rows }: { columns: string[]; rows: any[] }) {
  if (rows.length === 0) return <p style={{ color: '#94a3b8', fontSize: 13 }}>No results found.</p>;

  return (
    <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #e2e8f0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f8fafc' }}>
            {columns.map((col) => (
              <th key={col} style={{
                padding: '8px 12px',
                textAlign: 'left',
                fontWeight: 600,
                color: '#475569',
                borderBottom: '1px solid #e2e8f0',
                whiteSpace: 'nowrap',
              }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
              {columns.map((col) => (
                <td key={col} style={{
                  padding: '7px 12px',
                  color: '#334155',
                  borderBottom: '1px solid #f1f5f9',
                  maxWidth: 240,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {row[col] != null ? String(row[col]) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LineChartCard({ rows, config }: { rows: any[]; config: ChartConfig }) {
  if (rows.length === 0) return <p style={{ color: '#94a3b8', fontSize: 13 }}>No data to chart.</p>;

  // Multi-series pivot when seriesKey is set
  let chartData: any[] = rows;
  let yKeys = config.yKeys;

  if (config.seriesKey) {
    // Build a map from xKey value → { [seriesValue]: yValue }
    // Format date x-values so the axis shows MM/DD/YY instead of raw epoch days.
    const getRaw = (r: any, key: string) => r[key] ?? r[key.toUpperCase()];
    const seriesValues = Array.from(new Set(rows.map((r) => getRaw(r, config.seriesKey!)))) as string[];
    const rawXValues = Array.from(new Set(rows.map((r) => getRaw(r, config.xKey))));
    // Sort numerically/lexically so dates are in order
    rawXValues.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    chartData = rawXValues.map((rawX) => {
      const xLabel = formatDateValue(rawX);
      const point: any = { [config.xKey]: xLabel };
      for (const sv of seriesValues) {
        const match = rows.find(
          (r) => getRaw(r, config.xKey) === rawX && getRaw(r, config.seriesKey!) === sv
        );
        const yCol = config.yKeys[0]?.key ?? '';
        point[sv] = match ? (getRaw(match, yCol) ?? 0) : 0;
      }
      return point;
    });

    yKeys = seriesValues.map((sv) => ({ key: sv, label: sv }));
  } else {
    // Normalise column names to match xKey (Snowflake returns UPPERCASE)
    chartData = rows.map((r) => {
      const normalised: any = {};
      for (const k of Object.keys(r)) {
        normalised[k] = r[k];
        // also expose lowercase alias so recharts dataKey works regardless of case
        normalised[k.toLowerCase()] = r[k];
      }
      return normalised;
    });
  }

  return (
    <div>
      {config.title && (
        <p style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 8 }}>{config.title}</p>
      )}
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey={config.xKey} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => formatDateValue(v)} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={44} tickFormatter={(v) => config.yUnit === '%' ? `${v}%` : String(v)} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
          {yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {yKeys.map((yk, i) => (
            <Line
              key={yk.key}
              type="monotone"
              dataKey={yk.key}
              name={yk.label}
              stroke={LINE_COLOURS[i % LINE_COLOURS.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function PhysicianSearchFallback({
  state,
  onSelect,
  onDismiss,
}: {
  state: DisambiguateState;
  onSelect: (name: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 60,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.35)',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 16,
        padding: 24,
        width: 380,
        maxWidth: '90vw',
        boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <p style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>Did you mean one of these physicians?</p>
            <p style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>No exact match found — select a physician to refine your query.</p>
          </div>
          <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4 }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {state.candidates.map((c) => (
            <button
              key={c.physicianId}
              onClick={() => onSelect(`${c.firstName} ${c.lastName}`)}
              style={{
                textAlign: 'left',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: '10px 14px',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#f0f9ff'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#f8fafc'; }}
            >
              <p style={{ fontWeight: 600, fontSize: 13, color: '#1e3a5f' }}>
                {c.firstName} {c.lastName}
              </p>
              <p style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                {c.specialty} · {c.city}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Example queries ───────────────────────────────────────────────────────────

const EXAMPLE_QUERIES = [
  'Show me Rx trends for Venclexta over the last 6 months',
  'Which physicians in my territory have the highest overall score?',
  'How many calls have I logged this month?',
  'List open loopback tasks for my territory',
];

// ── Main component ────────────────────────────────────────────────────────────

const STORAGE_KEY = 'pitchmd_intelligence_sessions';

function loadSessions(): ISession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSessions(sessions: ISession[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); } catch { /* ignore */ }
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

export default function IntelligenceDrawer({ open, onClose }: IntelligenceDrawerProps) {
  const [sessions, setSessions] = useState<ISession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [disambiguate, setDisambiguate] = useState<DisambiguateState | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load sessions from localStorage on mount
  useEffect(() => {
    const stored = loadSessions();
    setSessions(stored);
    if (stored.length > 0) setActiveSessionId(stored[0].id);
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const messages = activeSession?.messages ?? [];

  const updateSessionMessages = useCallback((sessionId: string, updater: (msgs: IMessage[]) => IMessage[]) => {
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === sessionId ? { ...s, messages: updater(s.messages) } : s
      );
      saveSessions(next);
      return next;
    });
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const createNewSession = useCallback(() => {
    const id = `session-${Date.now()}`;
    const session: ISession = { id, title: 'New Chat', createdAt: Date.now(), messages: [] };
    setSessions((prev) => {
      const next = [session, ...prev];
      saveSessions(next);
      return next;
    });
    setActiveSessionId(id);
    setDisambiguate(null);
    setInput('');
  }, []);

  const deleteSession = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      saveSessions(next);
      if (activeSessionId === sessionId) {
        setActiveSessionId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });
  }, [activeSessionId]);

  const runQuery = useCallback(async (query: string, sessionId?: string) => {
    if (!query.trim()) return;

    // Use provided sessionId or create a new session if none active
    let sid = sessionId ?? activeSessionId;
    if (!sid) {
      const id = `session-${Date.now()}`;
      const session: ISession = { id, title: query.slice(0, 50), createdAt: Date.now(), messages: [] };
      setSessions((prev) => {
        const next = [session, ...prev];
        saveSessions(next);
        return next;
      });
      setActiveSessionId(id);
      sid = id;
    } else {
      // Update title from first message
      setSessions((prev) => {
        const target = prev.find((s) => s.id === sid);
        if (target && target.messages.length === 0 && target.title === 'New Chat') {
          const next = prev.map((s) => s.id === sid ? { ...s, title: query.slice(0, 50) } : s);
          saveSessions(next);
          return next;
        }
        return prev;
      });
    }

    const msgId = `msg-${Date.now()}`;
    const newMsg: IMessage = {
      id: msgId, query,
      outputType: null, columns: [], rows: [],
      chartConfig: null, statConfig: null,
      narrative: '', loading: true, error: null,
    };
    updateSessionMessages(sid, (msgs) => [...msgs, newMsg]);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/intelligence/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        updateSessionMessages(sid, (msgs) =>
          msgs.map((m) => m.id === msgId ? { ...m, loading: false, error: 'Request failed.' } : m)
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let evt: any;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          if (evt.type === 'data') {
            updateSessionMessages(sid!, (msgs) =>
              msgs.map((m) =>
                m.id === msgId
                  ? { ...m, outputType: evt.outputType, columns: evt.columns, rows: evt.rows, chartConfig: evt.chartConfig, statConfig: evt.statConfig }
                  : m
              )
            );
          } else if (evt.type === 'token') {
            updateSessionMessages(sid!, (msgs) =>
              msgs.map((m) => m.id === msgId ? { ...m, narrative: m.narrative + evt.text } : m)
            );
          } else if (evt.type === 'disambiguate') {
            setDisambiguate({ candidates: evt.candidates, originalQuery: evt.originalQuery, pendingMsgId: msgId });
            updateSessionMessages(sid!, (msgs) =>
              msgs.map((m) => m.id === msgId ? { ...m, loading: false } : m)
            );
          } else if (evt.type === 'blocked') {
            updateSessionMessages(sid!, (msgs) =>
              msgs.map((m) => m.id === msgId ? { ...m, loading: false, error: evt.reason, isBlocked: true } : m)
            );
          } else if (evt.type === 'error') {
            updateSessionMessages(sid!, (msgs) =>
              msgs.map((m) => m.id === msgId ? { ...m, loading: false, error: evt.message } : m)
            );
          } else if (evt.type === 'done') {
            updateSessionMessages(sid!, (msgs) =>
              msgs.map((m) => m.id === msgId ? { ...m, loading: false } : m)
            );
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        updateSessionMessages(sid!, (msgs) =>
          msgs.map((m) => m.id === msgId ? { ...m, loading: false, error: err?.message ?? 'Network error' } : m)
        );
      }
    }
  }, [activeSessionId, updateSessionMessages]);

  const handleSubmit = () => {
    const q = input.trim();
    if (!q) return;
    setInput('');
    runQuery(q);
  };

  const handleDisambiguateSelect = (physicianName: string) => {
    if (!disambiguate) return;
    const refined = `${disambiguate.originalQuery} (physician: ${physicianName})`;
    setDisambiguate(null);
    updateSessionMessages(activeSessionId!, (msgs) =>
      msgs.filter((m) => m.id !== disambiguate.pendingMsgId)
    );
    setInput(refined);
    runQuery(refined, activeSessionId!);
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 39,
            background: 'rgba(0,0,0,0.15)',
          }}
        />
      )}

      {/* Drawer */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '65vh',
        transform: open ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)',
        background: '#fff',
        borderRadius: '20px 20px 0 0',
        boxShadow: '0 -4px 32px rgba(0,0,0,0.12)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Layout: side panel + main */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

          {/* ── Side panel ─────────────────────────────────────────────── */}
          <div style={{
            width: 220,
            borderRight: '1px solid #f1f5f9',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            background: '#fafaf9',
          }}>
            {/* Side header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 14px 10px',
              borderBottom: '1px solid #f1f5f9',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <HelpCircle size={14} color="#4f7eff" />
                <span style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>Territory Intelligence</span>
              </div>
              <button
                onClick={createNewSession}
                title="New chat"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 3, borderRadius: 5, display: 'flex' }}
              >
                <SquarePen size={15} />
              </button>
            </div>

            {/* Session list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
              {sessions.length === 0 && (
                <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 24 }}>No chats yet</p>
              )}
              {sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => { setActiveSessionId(s.id); setDisambiguate(null); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: s.id === activeSessionId ? '#F1EFE9' : 'transparent',
                    border: s.id === activeSessionId ? '1px solid #e2ddd6' : '1px solid transparent',
                    marginBottom: 2,
                    transition: 'background 0.15s',
                    gap: 6,
                  }}
                  onMouseEnter={(e) => {
                    if (s.id !== activeSessionId) (e.currentTarget as HTMLDivElement).style.background = '#f5f3ef';
                  }}
                  onMouseLeave={(e) => {
                    if (s.id !== activeSessionId) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p style={{
                      fontSize: 12,
                      fontWeight: s.id === activeSessionId ? 600 : 500,
                      color: '#1e293b',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      margin: 0,
                    }}>
                      {s.title}
                    </p>
                    <p style={{ fontSize: 11, color: '#94a3b8', margin: '1px 0 0' }}>{relativeTime(s.createdAt)}</p>
                  </div>
                  <button
                    onClick={(e) => deleteSession(s.id, e)}
                    title="Delete"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', padding: 2, borderRadius: 4, flexShrink: 0, display: 'flex' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#cbd5e1'; }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* ── Main chat area ──────────────────────────────────────────── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

            {/* Main header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 20px 12px',
              borderBottom: '1px solid #f1f5f9',
              flexShrink: 0,
            }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
                {activeSession ? activeSession.title : 'New Chat'}
              </span>
              <button
                onClick={onClose}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4, borderRadius: 6 }}
              >
                <ChevronDown size={18} />
              </button>
            </div>

            {/* Messages */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
            }}>
              {messages.length === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
                  <HelpCircle size={32} color="#cbd5e1" />
                  <p style={{ fontSize: 14, color: '#94a3b8', fontWeight: 500 }}>Ask about your territory</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 480 }}>
                    {EXAMPLE_QUERIES.map((q) => (
                      <button
                        key={q}
                        onClick={() => { setInput(q); }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, #C47B42, #C49868, #45A8C8)';
                          (e.currentTarget as HTMLButtonElement).style.color = '#fff';
                          (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = '#F1EFE9';
                          (e.currentTarget as HTMLButtonElement).style.color = '#5c4a32';
                          (e.currentTarget as HTMLButtonElement).style.borderColor = '#e2ddd6';
                        }}
                        style={{
                          fontSize: 14, color: '#5c4a32', background: '#F1EFE9',
                          border: '1px solid #e2ddd6', borderRadius: 99, padding: '7px 16px',
                          cursor: 'pointer', fontWeight: 500,
                          transition: 'background 0.2s, color 0.2s, border-color 0.2s',
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <span style={{
                      background: '#4f7eff', color: '#fff',
                      borderRadius: '14px 14px 4px 14px',
                      padding: '8px 14px', fontSize: 13, maxWidth: '75%',
                    }}>
                      {msg.query}
                    </span>
                  </div>
                  <div style={{
                    background: '#faf8f5', border: '1px solid #ede9e3',
                    borderRadius: 12, padding: '14px 16px',
                    display: 'flex', flexDirection: 'column', gap: 12,
                  }}>
                    {msg.loading && !msg.outputType && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: '#94a3b8', fontSize: 13 }}>
                        <span style={{ animation: 'pulse 1.2s infinite' }}>●</span>
                        <span style={{ animation: 'pulse 1.2s infinite 0.2s' }}>●</span>
                        <span style={{ animation: 'pulse 1.2s infinite 0.4s' }}>●</span>
                      </div>
                    )}
                    {msg.error && !msg.isBlocked && (
                      <p style={{ fontSize: 13, color: '#ef4444', margin: 0 }}>{msg.error}</p>
                    )}
                    {msg.isBlocked && msg.error && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <p style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', margin: 0 }}>
                          {msg.error}
                        </p>
                        <button
                          onClick={() => {
                            const email = process.env.NEXT_PUBLIC_ANALYTICS_TEAM_EMAIL ?? 'analytics@yourcompany.com';
                            const subject = encodeURIComponent('Territory Intelligence Query — Field Analytics Follow-up');
                            const body = encodeURIComponent(`Hi Field Analytics Team,\n\nI had a question that Territory Intelligence couldn't answer:\n\n"${msg.query}"\n\nCould you help with this?\n\nThanks`);
                            window.open(`mailto:${email}?subject=${subject}&body=${body}`);
                          }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, #C47B42, #C49868, #45A8C8)'; (e.currentTarget as HTMLButtonElement).style.color = '#fff'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#F1EFE9'; (e.currentTarget as HTMLButtonElement).style.color = '#5c4a32'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#e2ddd6'; }}
                          style={{
                            alignSelf: 'flex-start',
                            fontSize: 13, fontWeight: 500,
                            color: '#5c4a32', background: '#F1EFE9',
                            border: '1px solid #e2ddd6', borderRadius: 99,
                            padding: '7px 16px', cursor: 'pointer',
                            transition: 'background 0.2s, color 0.2s, border-color 0.2s',
                          }}
                        >
                          Send to Field Analytics Team
                        </button>
                      </div>
                    )}
                    {msg.outputType === 'stat' && msg.statConfig && <StatCard rows={msg.rows} config={msg.statConfig} />}
                    {msg.outputType === 'chart' && msg.chartConfig && <LineChartCard rows={msg.rows} config={msg.chartConfig} />}
                    {msg.outputType === 'table' && <DataTable columns={msg.columns} rows={msg.rows} />}
                    {msg.narrative && (() => {
                      const { heading, body } = parseNarrative(msg.narrative);
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {heading && (
                            <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: 0 }}>{heading}</p>
                          )}
                          <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: 0 }}>
                            {body}
                            {msg.loading && <span style={{ opacity: 0.5 }}>▋</span>}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input bar — pill form */}
            <div style={{ flexShrink: 0, padding: '12px 20px 16px', borderTop: '1px solid #f1f5f9', background: '#fff' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: '#F1EFE9', border: '1px solid #e2ddd6',
                borderRadius: 999, padding: '6px 6px 6px 18px',
              }}>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                  placeholder="Ask about your territory data..."
                  style={{ flex: 1, border: 'none', background: 'transparent', padding: '5px 0', fontSize: 14, color: '#0f172a', outline: 'none' }}
                />
                <button
                  onClick={handleSubmit}
                  disabled={!input.trim()}
                  style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: input.trim() ? 'linear-gradient(135deg, #C47B42, #C49868, #45A8C8)' : '#e2ddd6',
                    border: 'none', cursor: input.trim() ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, transition: 'background 0.15s',
                  }}
                >
                  <ArrowUp size={16} color={input.trim() ? '#fff' : '#94a3b8'} />
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Disambiguation popup */}
      {disambiguate && (
        <PhysicianSearchFallback
          state={disambiguate}
          onSelect={handleDisambiguateSelect}
          onDismiss={() => setDisambiguate(null)}
        />
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </>
  );
}
