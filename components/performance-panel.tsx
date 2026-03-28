'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';

interface PerformancePanelProps {
  open: boolean;
  onClose: () => void;
}

const DIM_COLORS = ['#6b93c4', '#5fa882', '#c9a448', '#8b78c0', '#c97070'];
const DIMS = [
  { key: 'CLINICAL_KNOWLEDGE_SCORE',  label: 'Clinical Knowledge', short: 'CK' },
  { key: 'OBJECTION_HANDLING_SCORE',  label: 'Objection Handling',  short: 'OH' },
  { key: 'COMPLIANCE_SCORE',          label: 'Compliance',          short: 'CO' },
  { key: 'TONE_RAPPORT_SCORE',        label: 'Tone & Rapport',      short: 'TR' },
  { key: 'CLOSING_SCORE',             label: 'Closing',             short: 'CL' },
];

function parseSnowflakeDate(val: any): Date | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!isNaN(n) && Number.isInteger(n) && n > 0 && n < 99999) {
    const utc = new Date(n * 86400000);
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
  }
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(str.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(val: any): string {
  const d = parseSnowflakeDate(val);
  if (!d) return '';
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function readinessColor(r: string | null) {
  if (!r) return 'bg-slate-100 text-slate-600';
  if (r === 'Field Ready') return 'bg-green-100 text-green-700';
  if (r.includes('Coaching')) return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
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
}: {
  title: string;
  subtitle?: string;
  summary: any;
  trendRows: any[];
}) {
  const [expanded, setExpanded] = useState(false);
  const trendData    = toChartRows(trendRows);
  const score        = summary?.OVERALL_SCORE != null ? Number(summary.OVERALL_SCORE) : null;
  const readiness    = summary?.FIELD_READINESS ?? null;
  const sessionCount = Number(summary?.SESSION_COUNT ?? 0);
  const isEmpty      = sessionCount === 0;

  return (
    <div className={`border rounded-xl bg-white overflow-hidden ${isEmpty ? 'border-dashed border-slate-200 opacity-60' : 'border-slate-200'}`}>
      {/* ── Collapsed header ── */}
      <button
        onClick={() => !isEmpty && setExpanded(v => !v)}
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
              <span className="text-slate-400 text-lg ml-2">{expanded ? '−' : '+'}</span>
            </>
          )}
        </div>
      </button>

      {/* ── Expanded content ── */}
      {!isEmpty && expanded && (
        <div className="border-t border-slate-100 px-6 pb-6 space-y-5">
          <p className="text-xs text-slate-400 pt-4">
            Aggregated across {sessionCount} most recent session{sessionCount !== 1 ? 's' : ''} with this physician segment.
          </p>

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
export default function PerformancePanel({ open, onClose }: PerformancePanelProps) {
  const [summary, setSummary]                   = useState<any>(null);
  const [trend, setTrend]                       = useState<any[]>([]);
  const [segmentSummaries, setSegmentSummaries] = useState<any[]>([]);
  const [segmentTrends, setSegmentTrends]       = useState<any[]>([]);
  const [loading, setLoading]                   = useState(false);
  const [noData, setNoData]                     = useState(false);
  const [error, setError]                       = useState<string | null>(null);

  useEffect(() => {
    if (open) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    setNoData(false);
    try {
      const res = await fetch('/api/evaluation/performance');
      if (res.status === 404) { setNoData(true); setSummary(null); return; }
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Could not load performance data'); }
      const data = await res.json();
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

  // Group segment trend rows by SEGMENT_NAME
  const trendBySegment: Record<string, any[]> = {};
  for (const row of segmentTrends) {
    const seg = row.SEGMENT_NAME ?? 'Unknown';
    if (!trendBySegment[seg]) trendBySegment[seg] = [];
    trendBySegment[seg].push(row);
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto"
        style={{ maxWidth: '72rem', width: '90vw' }}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-slate-900">
            Performance Review
          </DialogTitle>
        </DialogHeader>

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
          <div className="space-y-3">
            {/* ── Overall ── */}
            <ScoreRibbon
              title="Overall Score"
              subtitle={`Across ${summary.SEGMENT_COUNT ?? 0} segment${(summary.SEGMENT_COUNT ?? 0) !== 1 ? 's' : ''} × 3 most recent sessions`}
              summary={summary}
              trendRows={trend}
            />

            {/* ── Per-segment ── */}
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
                  />
                ))}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
