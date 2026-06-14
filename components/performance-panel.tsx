'use client';

import { useEffect, useState } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { formatDate } from '@/lib/dates';

interface PerformancePanelProps {
  onBack: () => void;
}

const DIM_COLORS = ['#6b93c4', '#5fa882', '#c9a448', '#8b78c0', '#c97070'];
const DIMS = [
  { key: 'CLINICAL_KNOWLEDGE_SCORE',  label: 'Clinical Knowledge', short: 'CK' },
  { key: 'OBJECTION_HANDLING_SCORE',  label: 'Objection Handling',  short: 'OH' },
  { key: 'COMPLIANCE_SCORE',          label: 'Compliance',          short: 'CO' },
  { key: 'TONE_RAPPORT_SCORE',        label: 'Tone & Rapport',      short: 'TR' },
  { key: 'CLOSING_SCORE',             label: 'Closing',             short: 'CL' },
];

function readinessColor(r: string | null) {
  if (!r) return 'bg-slate-100 text-slate-500';
  if (r === 'Field Ready') return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
  if (r.includes('Coaching')) return 'bg-amber-50 text-amber-700 border border-amber-200';
  return 'bg-red-50 text-red-700 border border-red-200';
}

function toChartRows(rows: any[]) {
  return rows.map((r: any) => ({
    date:    formatDate(r.EVALUATED_AT),
    Overall: r.OVERALL_SCORE              != null ? Number(r.OVERALL_SCORE)              : null,
    CK:      r.CLINICAL_KNOWLEDGE_SCORE   != null ? Number(r.CLINICAL_KNOWLEDGE_SCORE)   : null,
    OH:      r.OBJECTION_HANDLING_SCORE   != null ? Number(r.OBJECTION_HANDLING_SCORE)   : null,
    CO:      r.COMPLIANCE_SCORE           != null ? Number(r.COMPLIANCE_SCORE)           : null,
    TR:      r.TONE_RAPPORT_SCORE         != null ? Number(r.TONE_RAPPORT_SCORE)         : null,
    CL:      r.CLOSING_SCORE             != null ? Number(r.CLOSING_SCORE)              : null,
  }));
}

// ── Shared collapsible ribbon ────────────────────────────────────────────
function ScoreRibbon({
  title,
  subtitle,
  summary,
  trendRows,
  expanded,
  onToggle,
}: {
  title: string;
  subtitle?: string;
  summary: any;
  trendRows: any[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const trendData    = toChartRows(trendRows);
  const score        = summary?.OVERALL_SCORE != null ? Number(summary.OVERALL_SCORE) : null;
  const readiness    = summary?.FIELD_READINESS ?? null;
  const sessionCount = Number(summary?.SESSION_COUNT ?? 0);
  const isEmpty      = sessionCount === 0;

  return (
    <div className={`border rounded-xl bg-white overflow-hidden ${isEmpty ? 'border-dashed border-slate-200 opacity-60' : 'border-slate-200'}`}>
      <button
        onClick={() => !isEmpty && onToggle()}
        className={`w-full flex items-center justify-between px-6 py-5 transition-colors ${isEmpty ? 'cursor-default' : 'hover:bg-slate-50'}`}
      >
        <div className="text-left">
          <span className="text-sm font-bold text-slate-800 uppercase tracking-wide">
            {title}
          </span>
          {subtitle && (
            <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-6">
          {isEmpty ? (
            <span className="text-xs text-slate-400 italic">No sessions yet</span>
          ) : (
            <>
              {readiness && (
                <span className={`text-xs font-bold px-3 py-1 rounded-full ${readinessColor(readiness)}`}>
                  {readiness}
                </span>
              )}
              <span className="text-2xl font-bold text-slate-900">
                {score != null ? score.toFixed(1) : '—'}
                <span className="text-sm font-normal text-slate-400"> /10</span>
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke={expanded ? '#BF4E19' : '#cbd5e1'}
                strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                className="ml-2 shrink-0">
                <polyline points={expanded ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
              </svg>
            </>
          )}
        </div>
      </button>

      {!isEmpty && expanded && (
        <div className="border-t border-slate-100 px-6 pb-6 space-y-5">
          <p className="text-xs text-slate-400 pt-4">
            Aggregated across {sessionCount} most recent session{sessionCount !== 1 ? 's' : ''} with this physician segment.
          </p>

          {/* Dimension mini-cards */}
          <div className="grid grid-cols-5 gap-2">
            {DIMS.map((d, i) => {
              const score = summary?.[d.key] != null ? Number(summary[d.key]) : null;
              const pct = score != null ? (score / 10) * 100 : 0;
              const scoreColor = score == null ? '#94a3b8' : score >= 8 ? '#047857' : score >= 6 ? '#b45309' : '#dc2626';
              const bg = score == null ? '#f8fafc' : score >= 8 ? '#f0fdf9' : score >= 6 ? '#fefce8' : '#fff7ed';
              const border = score == null ? '#e2e8f0' : score >= 8 ? '#a7f3d0' : score >= 6 ? '#fef08a' : '#fed7aa';
              return (
                <div key={d.short} className="rounded-xl p-2.5 text-center" style={{ background: bg, border: `1px solid ${border}` }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: DIM_COLORS[i] }}>{d.short}</p>
                  <p className="text-xl font-bold" style={{ color: scoreColor }}>{score != null ? score.toFixed(1) : '—'}</p>
                  <div className="h-1 rounded-full my-1.5" style={{ background: '#e2e8f0' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: DIM_COLORS[i] }} />
                  </div>
                  <p className="text-[9px] text-slate-400 leading-tight">{d.label}</p>
                </div>
              );
            })}
          </div>

          {summary?.COACHING_PRIORITY && (
            <div>
              <p className="text-sm font-bold text-slate-800 mb-1">Coaching Priority</p>
              <p className="text-sm text-slate-700 leading-relaxed">{summary.COACHING_PRIORITY}</p>
            </div>
          )}

          <div>
            <p className="text-sm font-bold text-slate-800 mb-3">Score Trend — Past 12 Months</p>
            {trendData.length === 0 ? (
              <p className="text-sm text-slate-400">Not enough data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 60 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    angle={-45}
                    textAnchor="end"
                    interval="preserveStartEnd"
                    height={65}
                  />
                  <YAxis domain={[0, 10]} tick={{ fontSize: 11 }} width={28} />
                  <Tooltip />
                  <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11, paddingBottom: 8 }} />
                  <Area
                    type="monotone" dataKey="Overall"
                    fill="#dbeafe" stroke="#6b93c4" strokeWidth={2} fillOpacity={0.4} connectNulls
                  />
                  {DIMS.map((d, i) => (
                    <Line
                      key={d.short} type="monotone" dataKey={d.short}
                      stroke={DIM_COLORS[i]} strokeWidth={1.5} dot={false} connectNulls
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            )}
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 justify-center">
              {DIMS.map((d, i) => (
                <span key={d.short} className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: DIM_COLORS[i] }} />
                  <span className="font-semibold text-slate-700">{d.short}</span> — {d.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────
export default function PerformancePanel({ onBack }: PerformancePanelProps) {
  const [summary, setSummary]                   = useState<any>(null);
  const [trend, setTrend]                       = useState<any[]>([]);
  const [segmentSummaries, setSegmentSummaries] = useState<any[]>([]);
  const [segmentTrends, setSegmentTrends]       = useState<any[]>([]);
  const [loading, setLoading]                   = useState(false);
  const [noData, setNoData]                     = useState(false);
  const [error, setError]                       = useState<string | null>(null);
  const [expandedKey, setExpandedKey]           = useState<string>('__overall__');

  const toggle = (key: string) =>
    setExpandedKey(prev => (prev === key ? '' : key));

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    setNoData(false);
    try {
      const res = await fetch('/api/evaluation/performance');
      if (res.status === 404) { setNoData(true); setSummary(null); return; }
      const text = await res.text();
      const body = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(body.error || 'Could not load performance data');
      const data = body;
      setSummary(data.summary);
      setTrend(data.trend ?? []);
      setSegmentSummaries(data.segmentSummaries ?? []);
      setSegmentTrends(data.segmentTrends ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const trendBySegment: Record<string, any[]> = {};
  for (const row of segmentTrends) {
    const seg = row.SEGMENT_NAME ?? 'Unknown';
    if (!trendBySegment[seg]) trendBySegment[seg] = [];
    trendBySegment[seg].push(row);
  }

  return (
    <div className="flex flex-col h-full min-h-0" style={{ backgroundColor: '#F1EFE9' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100 bg-white shrink-0">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#BF4E19' }}>Pre-field</span>
          <p className="text-lg font-semibold text-slate-900">Review Performance</p>
          <p className="text-sm text-slate-400">Scores and feedback from your recent training sessions</p>
        </div>
        <button
          onClick={onBack}
          className="text-sm text-slate-400 hover:text-slate-700 px-3 py-1 rounded-full hover:bg-slate-100 transition-colors"
        >
          Back
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading && (
          <div className="py-12 text-center text-sm text-slate-500">
            Loading performance data…
          </div>
        )}
        {!loading && noData && (
          <div className="py-16 text-center">
            <p className="text-slate-500 font-medium">No evaluation data on record yet.</p>
            <p className="text-sm text-slate-400 mt-1">Complete a training session to see your performance.</p>
          </div>
        )}
        {!loading && error && (
          <div className="py-6 text-center text-sm text-red-500">{error}</div>
        )}

        {!loading && summary && (
          <>
            <ScoreRibbon
              title="Overall Score"
              subtitle={`Across ${summary.SEGMENT_COUNT ?? 0} segment${(summary.SEGMENT_COUNT ?? 0) !== 1 ? 's' : ''} × 3 most recent sessions`}
              summary={summary}
              trendRows={trend}
              expanded={expandedKey === '__overall__'}
              onToggle={() => toggle('__overall__')}
            />

            {segmentSummaries.length > 0 && (
              <>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 px-1 pt-2">
                  By Segment
                </p>
                {segmentSummaries.map((seg: any) => (
                  <ScoreRibbon
                    key={seg.SEGMENT_NAME}
                    title={seg.SEGMENT_NAME}
                    subtitle={`${seg.SESSION_COUNT ?? 0} most recent session${(seg.SESSION_COUNT ?? 0) !== 1 ? 's' : ''}`}
                    summary={seg}
                    trendRows={trendBySegment[seg.SEGMENT_NAME] ?? []}
                    expanded={expandedKey === seg.SEGMENT_NAME}
                    onToggle={() => toggle(seg.SEGMENT_NAME)}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
