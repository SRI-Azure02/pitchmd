'use client';

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ComposedChart, Area, Line, XAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { parseSnowflakeDate, formatDateTime } from '@/lib/dates';

interface EvaluationPanelProps {
  open: boolean;
  onClose: () => void;
  content: string;
  username?: string;
  physicianId?: string | null;
  generating?: boolean;    // true while REPEVAL is running — show skeleton
  refreshTrigger?: number; // increment to force a re-fetch
}

const DIMENSIONS = [
  { key: 'CLINICAL_KNOWLEDGE_SCORE', label: 'Clinical Knowledge', short: 'CK' },
  { key: 'OBJECTION_HANDLING_SCORE', label: 'Objection Handling', short: 'OH' },
  { key: 'COMPLIANCE_SCORE', label: 'Compliance', short: 'CO' },
  { key: 'TONE_RAPPORT_SCORE', label: 'Tone & Rapport', short: 'TR' },
  { key: 'CLOSING_SCORE', label: 'Closing', short: 'CL' },
];

const DIM_COLORS = ['#6b93c4', '#5fa882', '#c9a448', '#8b78c0', '#c97070'];


function Dot({ value }: { value: boolean | null }) {
  if (value === null || value === undefined) return <span className="inline-block w-3 h-3 rounded-full bg-slate-200" />;
  return <span className={`inline-block w-3 h-3 rounded-full ${value ? 'bg-green-500' : 'bg-red-400'}`} />;
}

function ScoreBar({ score, max = 10 }: { score: number; max?: number }) {
  const pct = (score / max) * 100;
  const color = score >= 8 ? 'bg-green-500' : score >= 6 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="w-full h-1.5 bg-slate-100 rounded-full">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function CollapsibleDimension({ title, score, rationale, indicators, sessionCount }: {
  title: string;
  score: number | null;
  rationale: string | null;
  indicators: { label: string; value: boolean | null }[];
  sessionCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const n = sessionCount ?? 1;
  return (
    <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="text-left">
            <span className="text-sm font-bold text-slate-800">{title}</span>
            <p className="text-xs text-slate-400">Median across {n} session{n !== 1 ? 's' : ''} · Indicators: majority vote</p>
          </div>
          {score !== null && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${score >= 8 ? 'bg-green-100 text-green-700' :
              score >= 6 ? 'bg-yellow-100 text-yellow-700' :
                'bg-red-100 text-red-700'
              }`}>{Number(score).toFixed(1)}/10</span>
          )}
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke={open ? '#BF4E19' : '#cbd5e1'}
          strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
          className="shrink-0">
          <polyline points={open ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-slate-100">
          {score !== null && <div className="pt-3"><ScoreBar score={score} /></div>}
          {rationale && <p className="text-sm text-slate-600 leading-relaxed">{rationale}</p>}
          {indicators.length > 0 && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
              {indicators.map((ind, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <Dot value={ind.value} />
                  <span className="text-sm text-slate-600 leading-snug">{ind.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SkeletonBox({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`bg-slate-100 rounded animate-pulse ${className ?? ''}`} style={style} />;
}

function EvalSkeleton({ generating }: { generating: boolean }) {
  return (
    <div className="space-y-4">
      {/* Status banner */}
      {generating && (
        <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <svg className="w-4 h-4 text-amber-500 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <p className="text-sm text-amber-700 font-medium">Generating evaluation report… this may take up to 2 minutes.</p>
        </div>
      )}

      {/* Top ribbon skeleton */}
      <div className="border border-slate-200 rounded-lg p-6 bg-white">
        <div className="flex items-stretch gap-0 mb-6">
          <div className="flex-1 flex flex-col pr-6 gap-3">
            <SkeletonBox className="h-4 w-28" />
            <SkeletonBox className="h-3 w-48" />
            <div className="flex-1 flex items-center justify-center pt-2">
              <SkeletonBox className="h-8 w-28 rounded-full" />
            </div>
          </div>
          <div className="w-px bg-slate-200 self-stretch mx-2" />
          <div className="flex-1 flex flex-col pl-6 gap-3">
            <SkeletonBox className="h-4 w-24" />
            <SkeletonBox className="h-3 w-40" />
            <div className="flex-1 flex items-center justify-center pt-2">
              <SkeletonBox className="h-12 w-20" />
            </div>
          </div>
        </div>
        <div className="border-t border-slate-100 pt-4 space-y-2">
          <SkeletonBox className="h-3 w-32" />
          <div className="flex gap-6">
            <SkeletonBox className="h-3 w-28" />
            <SkeletonBox className="h-3 w-36" />
            <SkeletonBox className="h-3 w-24" />
          </div>
        </div>
      </div>

      {/* Bar chart skeleton */}
      <div className="border border-slate-200 rounded-lg p-4 bg-white">
        <SkeletonBox className="h-4 w-40 mb-4" />
        <div className="flex items-end gap-4 h-36 px-2">
          {[65, 80, 55, 70, 60].map((h, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <SkeletonBox className="w-full rounded" style={{ height: `${h}%` }} />
              <SkeletonBox className="h-3 w-5" />
            </div>
          ))}
        </div>
      </div>

      {/* Coaching / recommendations skeleton */}
      <div className="border border-slate-200 rounded-lg p-5 bg-white space-y-3">
        <SkeletonBox className="h-4 w-48" />
        <SkeletonBox className="h-3 w-full" />
        <SkeletonBox className="h-3 w-5/6" />
        <SkeletonBox className="h-3 w-4/6" />
      </div>

      {/* Dimension cards skeleton */}
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="border border-slate-200 rounded-lg p-4 bg-white flex items-center justify-between">
          <div className="space-y-2 flex-1">
            <SkeletonBox className="h-4 w-36" />
            <SkeletonBox className="h-3 w-52" />
          </div>
          <SkeletonBox className="h-6 w-12 rounded-full" />
        </div>
      ))}

      {/* History chart skeleton */}
      <div className="border border-slate-200 rounded-lg p-4 bg-white">
        <SkeletonBox className="h-4 w-44 mb-4" />
        <SkeletonBox className="h-40 w-full rounded" />
      </div>
    </div>
  );
}

export default function EvaluationPanel({ open, onClose, content, username, physicianId, generating, refreshTrigger }: EvaluationPanelProps) {
  const [evaluation, setEvaluation] = useState<any>(null);
  const [historyWithPhysician, setHistoryWithPhysician] = useState<any[]>([]);
  const [sessionCount, setSessionCount] = useState<number>(1);
  const [physicianName, setPhysicianName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [noData, setNoData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (generating) {
      // REPEVAL still running — clear any stale data and stay on skeleton
      setEvaluation(null);
      setNoData(false);
      setError(null);
      setLoading(false);
      return;
    }
    // generating just became false (or panel opened with no active eval) — fetch fresh data
    fetchEvaluation();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, physicianId, generating]);

  const fetchEvaluation = async () => {
    setLoading(true);
    setError(null);
    setNoData(false);
    try {
      if (!physicianId) { setNoData(true); return; }
      const res = await fetch(`/api/evaluation?physicianId=${encodeURIComponent(physicianId)}`);
      if (res.status === 404) { setNoData(true); setEvaluation(null); return; }
      const text = await res.text();
      const body = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(body.error || 'Could not load evaluation');
      const data = body;
      setEvaluation(data.evaluation);
      const first = data.evaluation?.PHYSICIAN_FIRST_NAME;
      const last = data.evaluation?.PHYSICIAN_LAST_NAME;
      setPhysicianName([first, last].filter(Boolean).join(' ') || data.evaluation?.PHYSICIAN_ID || null);
      setHistoryWithPhysician(data.historyWithPhysician || []);
      setSessionCount(data.sessionCount ?? 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const e = evaluation;

  const fieldReadinessLabel = (): string => {
    const s = e?.OVERALL_SCORE;
    if (s == null) return '—';
    if (s >= 8) return 'Field Ready';
    if (s >= 6) return 'Coaching Needed';
    return 'Not Ready';
  };

  const fieldReadyColor = (): string => {
    const s = e?.OVERALL_SCORE;
    if (s == null) return 'bg-slate-100 text-slate-600';
    if (s >= 8) return 'bg-green-100 text-green-700';
    if (s >= 6) return 'bg-yellow-100 text-yellow-700';
    return 'bg-red-100 text-red-700';
  };

  const aggregationNote = `Aggregated across ${sessionCount} most recent session${sessionCount !== 1 ? 's' : ''} with this physician`;

  const histPhysicianData = historyWithPhysician.map((r: any) => ({
    date: formatDateTime(r.EVALUATED_AT),
    Overall: r.OVERALL_SCORE, CK: r.CLINICAL_KNOWLEDGE_SCORE, OH: r.OBJECTION_HANDLING_SCORE,
    CO: r.COMPLIANCE_SCORE, TR: r.TONE_RAPPORT_SCORE, CL: r.CLOSING_SCORE,
  }));

  function HistoryChart({ data, title, subtitle }: { data: any[]; title: string; subtitle?: string }) {
    if (!data.length) return (
      <div className="border border-slate-200 rounded-lg p-4 bg-white">
        <div className="mb-2">
          <p className="text-sm font-bold text-slate-800">{title}</p>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        <p className="text-sm text-slate-400">Not enough data yet</p>
      </div>
    );
    return (
      <div className="border border-slate-200 rounded-lg p-4 bg-white">
        <div className="mb-4">
          <p className="text-sm font-bold text-slate-800">{title}</p>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 60 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              interval={0}
              height={60}
              scale="point"
              padding={{ left: 0, right: 20 }}
            />
            <Tooltip />
            <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11, paddingBottom: 8 }} />
            <Area type="monotone" dataKey="Overall" fill="#dbeafe" stroke="#6b93c4" strokeWidth={2} fillOpacity={0.5} />
            {['CK', 'OH', 'CO', 'TR', 'CL'].map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} stroke={DIM_COLORS[i]} strokeWidth={1.5} dot={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto" style={{ maxWidth: '90rem', width: '90vw' }}>
        <DialogHeader>
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#BF4E19' }}>Session evaluation</span>
          <DialogTitle className="text-xl font-bold text-slate-900">
            Evaluation Report
            {physicianName && <span className="ml-2 text-base font-normal text-slate-500">— {physicianName}</span>}
          </DialogTitle>
          {e && <p className="text-xs text-slate-400 mt-0.5">{aggregationNote}</p>}
        </DialogHeader>
        {/* Skeleton — shown while REPEVAL is running (generating) or while loading fresh data */}
        {(generating || loading) && <EvalSkeleton generating={!!generating} />}
        {!generating && !loading && noData && (
          <div className="py-16 text-center">
            <p className="text-slate-500 font-medium">No evaluation on record yet for this physician.</p>
          </div>
        )}
        {!generating && !loading && error && <div className="py-6 text-center text-sm text-red-500">{error}</div>}
        {!generating && e && !loading && (
          <div className="space-y-4">
            <div className="border border-slate-200 rounded-lg p-6 bg-white">
              <div className="flex items-stretch gap-0 mb-6">
                <div className="flex-1 flex flex-col pr-6">
                  <p className="text-sm font-bold text-slate-800 mb-1">Field Readiness</p>
                  <p className="text-xs text-slate-400 mb-4">Based on median overall score across most recent {sessionCount} session{sessionCount !== 1 ? 's' : ''}</p>
                  <div className="flex-1 flex items-center justify-center">
                    <span className={`text-sm font-bold px-4 py-2 rounded-full ${fieldReadyColor()}`}>{fieldReadinessLabel()}</span>
                  </div>
                </div>
                <div className="w-px bg-slate-200 self-stretch mx-2" />
                <div className="flex-1 flex flex-col pl-6">
                  <p className="text-sm font-bold text-slate-800 mb-1">Overall Score</p>
                  <p className="text-xs text-slate-400 mb-4">Median across most recent {sessionCount} session{sessionCount !== 1 ? 's' : ''}</p>
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-5xl font-bold text-slate-900">{e.OVERALL_SCORE != null ? Number(e.OVERALL_SCORE).toFixed(1) : '—'}<span className="text-xl font-normal text-slate-400"> /10</span></p>
                  </div>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Qualifying Criteria</p>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500 shrink-0" />
                    <span className="text-xs text-slate-600"><span className="font-semibold text-slate-700">Field Ready</span> — Score ≥ 8</span>
                  </div>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
                    <span className="text-xs text-slate-600"><span className="font-semibold text-slate-700">Coaching Needed</span> — Score 6–7</span>
                  </div>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="inline-block w-2 h-2 rounded-full bg-red-400 shrink-0" />
                    <span className="text-xs text-slate-600"><span className="font-semibold text-slate-700">Not Ready</span> — Score &lt; 6</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="border border-slate-200 rounded-lg p-5 bg-white">
              <p className="text-sm font-bold text-slate-800 mb-1">Coaching Priority</p>
              <p className="text-xs text-slate-400 mb-3">Across most recent {sessionCount} session{sessionCount !== 1 ? 's' : ''}</p>
              {e.COACHING_PRIORITY && (
                <p className="text-sm font-medium text-slate-700 mb-3">{e.COACHING_PRIORITY}</p>
              )}
              {Array.isArray(e.RECOMMENDATIONS) && e.RECOMMENDATIONS.length > 0 ? (
                <ul className="space-y-2">{e.RECOMMENDATIONS.map((rec: string, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#2B5FA6' }} />
                    <span className="text-sm text-slate-700 leading-relaxed">{rec}</span>
                  </li>
                ))}</ul>
              ) : !e.COACHING_PRIORITY && <p className="text-sm text-slate-400">—</p>}
            </div>
            <div className="border border-slate-200 rounded-lg p-5 bg-white">
              <p className="text-sm font-bold text-slate-800 mb-1">Dimension Scores</p>
              <p className="text-xs text-slate-400 mb-4">Median across most recent {sessionCount} session{sessionCount !== 1 ? 's' : ''} · expand below for full details</p>
              <div className="grid grid-cols-5 gap-2">
                {DIMENSIONS.map((d, i) => {
                  const score = e?.[d.key] != null ? Number(e[d.key]) : null;
                  const pct = score != null ? (score / 10) * 100 : 0;
                  const scoreColor = score == null ? '#94a3b8' : score >= 8 ? '#047857' : score >= 6 ? '#b45309' : '#dc2626';
                  const bg = score == null ? '#f8fafc' : score >= 8 ? '#f0fdf9' : score >= 6 ? '#fefce8' : '#fff7ed';
                  const border = score == null ? '#e2e8f0' : score >= 8 ? '#a7f3d0' : score >= 6 ? '#fef08a' : '#fed7aa';
                  return (
                    <div key={d.short} className="rounded-xl p-3 text-center" style={{ background: bg, border: `1px solid ${border}` }}>
                      <p className="text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: DIM_COLORS[i] }}>{d.short}</p>
                      <p className="text-xl font-bold mb-1" style={{ color: scoreColor }}>{score != null ? score.toFixed(1) : '—'}</p>
                      <div className="h-1.5 rounded-full mb-1.5" style={{ background: '#e2e8f0' }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: DIM_COLORS[i] }} />
                      </div>
                      <p className="text-[9px] text-slate-400 leading-tight">{d.label}</p>
                    </div>
                  );
                })}
              </div>
            </div>
            <CollapsibleDimension title="Clinical Knowledge" score={e.CLINICAL_KNOWLEDGE_SCORE} rationale={e.CLINICAL_KNOWLEDGE_RATIONALE} sessionCount={sessionCount} indicators={[
              { label: 'Cited a peer-reviewed publication by name', value: e.CK_C1 },
              { label: 'Cited a major medical conference', value: e.CK_C2 },
              { label: 'Used specific quantitative data points', value: e.CK_C3 },
              { label: 'Referenced study design or methodology', value: e.CK_C4 },
              { label: 'Demonstrated mechanism-level understanding', value: e.CK_C5 },
              { label: 'Distinguished between evidence levels', value: e.CK_C6 },
              { label: 'Connected data to clinical relevance', value: e.CK_C7 },
              { label: 'Introduced patient scenarios unprompted', value: e.CK_C8 },
            ]} />
            <CollapsibleDimension title="Objection Handling" score={e.OBJECTION_HANDLING_SCORE} rationale={e.OBJECTION_HANDLING_RATIONALE} sessionCount={sessionCount} indicators={
              Array.isArray(e.OH_OBJECTION_DETAILS)
                ? e.OH_OBJECTION_DETAILS.flatMap((obj: any, i: number) => [
                  { label: `Objection ${i + 1}: ${obj.summary ?? ''}`, value: null },
                  { label: 'Acknowledge', value: !!obj.acknowledge },
                  { label: 'Reframe', value: !!obj.reframe },
                  { label: 'Evidence', value: !!obj.evidence },
                  { label: 'Qualify', value: !!obj.qualify },
                ]) : []
            } />
            <CollapsibleDimension title="Compliance" score={e.COMPLIANCE_SCORE} rationale={e.COMPLIANCE_RATIONALE} sessionCount={sessionCount} indicators={[
              { label: 'No off-label efficacy or indication claims', value: e.COMP_K1 },
              { label: 'No unsupported outcome claims', value: e.COMP_K2 },
              { label: 'Evidence levels clearly labeled', value: e.COMP_K3 },
              { label: 'No false or misleading competitive claims', value: e.COMP_K4 },
              { label: 'Appropriate qualifiers for limited evidence', value: e.COMP_K5 },
              { label: 'Presented both efficacy and safety data', value: e.COMP_K6 },
            ]} />
            <CollapsibleDimension title="Tone & Rapport" score={e.TONE_RAPPORT_SCORE} rationale={e.TONE_RAPPORT_RATIONALE} sessionCount={sessionCount} indicators={[
              { label: 'Used professional, appropriate language', value: e.TR_T1 },
              { label: 'Demonstrated confidence without arrogance', value: e.TR_T2 },
              { label: "Asked about physician's practice / patients", value: e.TR_T3 },
              { label: 'Acknowledged physician expertise', value: e.TR_T4 },
              { label: 'Adapted messaging to physician segment', value: e.TR_T5 },
              { label: 'Created conversational moments', value: e.TR_T6 },
              { label: 'Listened and built on physician responses', value: e.TR_T7 },
            ]} />
            <CollapsibleDimension title="Closing Technique" score={e.CLOSING_SCORE} rationale={e.CLOSING_RATIONALE} sessionCount={sessionCount} indicators={[
              { label: 'Summarized key value points', value: e.CL_L1 },
              { label: 'Asked a commitment question', value: e.CL_L2 },
              { label: 'Proposed a specific, concrete next step', value: e.CL_L3 },
              { label: 'Offered a tangible resource', value: e.CL_L4 },
              { label: 'Connected close to urgency or relevance', value: e.CL_L5 },
              { label: 'Established follow-up timeline', value: e.CL_L6 },
            ]} />
            <HistoryChart
              data={histPhysicianData}
              title={`Score Trend — ${physicianName ?? e.PHYSICIAN_ID ?? ''}`}
              subtitle={[e.PHYSICIAN_SPECIALTY, e.PHYSICIAN_ID].filter(Boolean).join(' — ')}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}