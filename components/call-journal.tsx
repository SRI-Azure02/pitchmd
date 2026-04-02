'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Mic, MicOff, Send, Edit2, ArrowLeft, Phone, Users,
} from 'lucide-react';

// ── US Federal Holidays 2025–2027 ─────────────────────────────────────────────
const US_HOLIDAYS = new Set([
  // 2025
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-05-26',
  '2025-06-19', '2025-07-04', '2025-09-01', '2025-10-13',
  '2025-11-11', '2025-11-27', '2025-12-25',
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25',
  '2026-06-19', '2026-07-04', '2026-09-07', '2026-10-12',
  '2026-11-11', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31',
  '2027-06-19', '2027-07-05', '2027-09-06', '2027-10-11',
  '2027-11-11', '2027-11-25', '2027-12-24',
]);

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekDays(anchor: Date): Date[] {
  const d = new Date(anchor);
  const dow = d.getDay(); // 0=Sun
  const mon = new Date(d);
  mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: 5 }, (_, i) => {
    const day = new Date(mon);
    day.setDate(mon.getDate() + i);
    return day;
  });
}

function getMonthWeekdays(anchor: Date): Date[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const days: Date[] = [];
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) days.push(new Date(d));
  }
  return days;
}

const MONTH_NAMES = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
const DAY_ABBR = ['Mon','Tue','Wed','Thu','Fri'];

// ── Readiness badge (copied from chat-interface) ──────────────────────────────
function readinessBadge(r: string): React.CSSProperties {
  const s = r?.toLowerCase() ?? '';
  if (s.includes('field')) return { background: '#dcfce7', color: '#15803d' };
  if (s.includes('almost') || s.includes('developing')) return { background: '#fef9c3', color: '#854d0e' };
  return { background: '#fee2e2', color: '#b91c1c' };
}

// ── Voice recorder hook ───────────────────────────────────────────────────────
interface RecorderState {
  recording: boolean;
  transcript: string;
  interim: string;
  waveData: number[];
}

function useVoiceRecorder(onFinalTranscript: (t: string) => void) {
  const [state, setState] = useState<RecorderState>({
    recording: false, transcript: '', interim: '', waveData: [],
  });
  const recognitionRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const finalRef = useRef('');

  const stopWaveform = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setState(s => ({ ...s, waveData: [] }));
  }, []);

  const startWaveform = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyserRef.current = analyser;
      analyser.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        setState(s => ({ ...s, waveData: Array.from(buf.slice(0, 24)) }));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // mic permission denied — waveform just won't show
    }
  }, []);

  const start = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    finalRef.current = '';
    const r = new SR();
    recognitionRef.current = r;
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onresult = (e: any) => {
      let interimText = '';
      let finalText = finalRef.current;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) { finalText += (finalText ? ' ' : '') + t.trim(); }
        else { interimText += t; }
      }
      finalRef.current = finalText;
      setState(s => ({ ...s, transcript: finalText, interim: interimText }));
    };
    r.onerror = () => stop();
    r.onend = () => {
      setState(s => ({ ...s, recording: false, interim: '' }));
      stopWaveform();
    };
    r.start();
    setState(s => ({ ...s, recording: true, transcript: '', interim: '' }));
    startWaveform();
  }, [startWaveform, stopWaveform]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    stopWaveform();
    setState(s => ({ ...s, recording: false, interim: '' }));
    if (finalRef.current) onFinalTranscript(finalRef.current);
  }, [stopWaveform, onFinalTranscript]);

  const reset = useCallback(() => {
    finalRef.current = '';
    setState({ recording: false, transcript: '', interim: '', waveData: [] });
  }, []);

  return { state, start, stop, reset };
}

// ── Waveform bar visualiser ───────────────────────────────────────────────────
function Waveform({ data }: { data: number[] }) {
  if (!data.length) {
    return (
      <div className="flex items-center gap-0.5 h-8">
        {Array.from({ length: 24 }, (_, i) => (
          <div key={i} className="w-1 rounded-full bg-slate-200" style={{ height: 4 }} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-0.5 h-8">
      {data.map((v, i) => {
        const h = Math.max(4, Math.round((v / 255) * 32));
        return (
          <div
            key={i}
            className="w-1 rounded-full transition-all duration-75"
            style={{ height: h, background: 'linear-gradient(to top, #FF6B00, #00C8FF)' }}
          />
        );
      })}
    </div>
  );
}

// ── Expanded note recorder row ────────────────────────────────────────────────
interface NoteRowProps {
  physician: any;
  existingNote: any | null;
  onSaved: (note: any) => void;
  onClose: () => void;
}

function NoteRow({ physician, existingNote, onSaved, onClose }: NoteRowProps) {
  const [editText, setEditText] = useState(existingNote?.TRANSCRIPT ?? '');
  const [editing, setEditing] = useState(!existingNote);
  const [summary, setSummary] = useState(existingNote?.AI_SUMMARY ?? '');
  const [saving, setSaving] = useState(false);
  const [noteId, setNoteId] = useState(existingNote?.NOTE_ID ?? null);

  const handleFinal = useCallback((t: string) => {
    setEditText(prev => (prev ? prev + ' ' + t : t));
  }, []);

  const recorder = useVoiceRecorder(handleFinal);

  const handleSubmit = async () => {
    const text = editText.trim();
    if (!text) return;
    setSaving(true);
    try {
      // Generate AI summary
      const sumRes = await fetch('/api/call-journal/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text }),
      });
      const { summary: aiSummary } = await sumRes.json();
      setSummary(aiSummary ?? '');

      const now = new Date();
      const callDate = toIso(now);
      const callTimestamp = now.toISOString();

      if (noteId) {
        await fetch('/api/call-journal/notes', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ noteId, transcript: text, aiSummary: aiSummary ?? '' }),
        });
      } else {
        await fetch('/api/call-journal/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            physicianId: physician.PHYSICIAN_ID,
            callDate,
            callTimestamp,
            transcript: text,
            aiSummary: aiSummary ?? '',
          }),
        });
      }
      setEditing(false);
      onSaved({ NOTE_ID: noteId, TRANSCRIPT: text, AI_SUMMARY: aiSummary ?? '', CALL_TIMESTAMP: callTimestamp });
    } catch (err) {
      console.error('[note-row] save error:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 space-y-3">
      {/* Waveform + recording controls */}
      {editing && (
        <div className="flex items-center gap-4">
          <button
            onClick={recorder.state.recording ? recorder.stop : recorder.start}
            className={`flex items-center gap-2 h-9 px-4 rounded-full text-sm font-medium transition-all ${
              recorder.state.recording
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
          >
            {recorder.state.recording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            {recorder.state.recording ? 'Stop recording' : 'Start recording'}
          </button>
          <Waveform data={recorder.state.waveData} />
        </div>
      )}

      {/* Live interim transcript indicator */}
      {recorder.state.recording && recorder.state.interim && (
        <p className="text-xs text-slate-400 italic truncate">{recorder.state.interim}</p>
      )}

      {/* Transcript textarea (editing) or read-only view */}
      {editing ? (
        <textarea
          className="w-full min-h-24 p-3 rounded-lg border border-slate-200 text-sm text-slate-700 resize-y focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white"
          placeholder="Transcription will appear here as you speak, or type manually…"
          value={editText + (recorder.state.interim ? ' ' + recorder.state.interim : '')}
          onChange={e => setEditText(e.target.value)}
        />
      ) : (
        <p className="text-sm text-slate-700 leading-relaxed">{editText}</p>
      )}

      {/* AI summary (post-submit) */}
      {!editing && summary && (
        <div className="flex items-start gap-2 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
          <span className="text-xs font-semibold text-orange-600 shrink-0 mt-0.5">AI Summary</span>
          <p className="text-xs text-orange-800 leading-relaxed">{summary}</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 justify-end">
        <button
          onClick={onClose}
          className="h-8 px-3 rounded-full text-xs text-slate-500 hover:bg-slate-200 transition-colors"
        >
          Close
        </button>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="h-8 px-3 rounded-full flex items-center gap-1.5 text-xs border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <Edit2 className="w-3 h-3" /> Edit
          </button>
        )}
        {editing && (
          <button
            onClick={handleSubmit}
            disabled={saving || !editText.trim()}
            className="h-8 px-4 rounded-full flex items-center gap-1.5 text-xs font-medium text-white transition-all disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #FF6B00, #00C8FF)' }}
          >
            <Send className="w-3 h-3" />
            {saving ? 'Saving…' : 'Submit'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main CallJournal component ────────────────────────────────────────────────
interface CallJournalProps {
  username: string;
  onBack: () => void;
}

export default function CallJournal({ username, onBack }: CallJournalProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [monthExpanded, setMonthExpanded] = useState(false);
  const [monthAnchor, setMonthAnchor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const [physicians, setPhysicians] = useState<any[]>([]);
  const [loadingPhysicians, setLoadingPhysicians] = useState(false);
  const [notes, setNotes] = useState<Record<string, any>>({}); // keyed by PHYSICIAN_ID
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

  const weekDays = getWeekDays(today);
  const monthDays = monthExpanded ? getMonthWeekdays(monthAnchor) : [];

  // Load physicians + notes for selected date
  useEffect(() => {
    const iso = toIso(selectedDate);
    setPhysicians([]);
    setNotes({});
    setExpandedRow(null);
    setLoadingPhysicians(true);

    Promise.all([
      fetch(`/api/call-journal/activity?date=${iso}`).then(r => r.json()),
      fetch(`/api/call-journal/notes?date=${iso}`).then(r => r.json()),
    ])
      .then(([actRes, notesRes]) => {
        setPhysicians(actRes.physicians ?? []);
        const noteMap: Record<string, any> = {};
        for (const n of notesRes.notes ?? []) noteMap[n.PHYSICIAN_ID] = n;
        setNotes(noteMap);
      })
      .catch(err => console.error('[call-journal] load error:', err))
      .finally(() => setLoadingPhysicians(false));
  }, [selectedDate]);

  const handleNoteSaved = (physicianId: string, note: any) => {
    setNotes(prev => ({ ...prev, [physicianId]: note }));
  };

  const isSelectable = (d: Date) => d <= today && d.getDay() !== 0 && d.getDay() !== 6;
  const isHoliday = (d: Date) => US_HOLIDAYS.has(toIso(d));
  const isToday = (d: Date) => toIso(d) === toIso(today);
  const isSelected = (d: Date) => toIso(d) === toIso(selectedDate);

  const renderDayBtn = (d: Date) => {
    const selectable = isSelectable(d);
    const holiday = isHoliday(d);
    const sel = isSelected(d);
    const todayFlag = isToday(d);
    const dow = d.getDay();
    const abbr = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow];
    const dateNum = d.getDate();

    let bg = 'bg-white text-slate-700 border border-slate-200';
    if (!selectable) bg = 'bg-slate-50 text-slate-300 border border-slate-100 cursor-not-allowed';
    else if (sel) bg = 'text-white border-transparent';
    else if (holiday) bg = 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100';
    else if (todayFlag) bg = 'bg-slate-100 text-slate-800 border border-slate-300 hover:bg-slate-200';
    else bg = 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50';

    return (
      <button
        key={toIso(d)}
        disabled={!selectable}
        onClick={() => selectable && setSelectedDate(new Date(d))}
        className={`relative flex flex-col items-center justify-center rounded-xl px-3 py-2 min-w-[52px] transition-all ${bg}`}
        style={sel ? { background: 'linear-gradient(135deg, #FF6B00, #00C8FF)' } : {}}
      >
        <span className="text-[10px] font-medium uppercase tracking-wide">{abbr}</span>
        <span className="text-base font-bold leading-tight">{dateNum}</span>
        {holiday && !sel && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400" title="US Holiday" />
        )}
      </button>
    );
  };

  const selectedIso = toIso(selectedDate);
  const selectedLabel = selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#F5F4EF]">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 bg-white/80 backdrop-blur-sm">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="w-px h-5 bg-slate-200" />
        <h1 className="text-lg font-semibold text-slate-900">Call Journal</h1>
      </div>

      {/* Week ribbon */}
      <div className="bg-white border-b border-slate-200 px-6 py-3">
        <div className="flex items-center gap-3">
          {/* Week days */}
          <div className="flex items-center gap-2 flex-1 overflow-x-auto">
            {weekDays.map(renderDayBtn)}
          </div>

          {/* Expand chevron */}
          <button
            onClick={() => setMonthExpanded(v => !v)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 shrink-0 transition-colors"
            title={monthExpanded ? 'Collapse to week' : 'Expand to month'}
          >
            {monthExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Month grid */}
        {monthExpanded && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))} className="p-1 hover:bg-slate-100 rounded-full transition-colors">
                <ChevronLeft className="w-4 h-4 text-slate-400" />
              </button>
              <span className="text-sm font-semibold text-slate-700">
                {MONTH_NAMES[monthAnchor.getMonth()]} {monthAnchor.getFullYear()}
              </span>
              <button
                onClick={() => setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                disabled={new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1) > today}
                className="p-1 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            {/* Day-of-week headers */}
            <div className="grid grid-cols-5 gap-1 mb-1">
              {DAY_ABBR.map(a => (
                <div key={a} className="text-center text-[10px] font-medium text-slate-400 uppercase tracking-wide py-1">{a}</div>
              ))}
            </div>
            {/* Day buttons in a 5-column grid */}
            <div className="grid grid-cols-5 gap-1">
              {monthDays.map(renderDayBtn)}
            </div>
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">{selectedLabel}</h2>
              <p className="text-xs text-slate-400 mt-0.5">Face-to-face and telephonic calls</p>
            </div>
          </div>

          {loadingPhysicians ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2">
              <div className="w-4 h-4 border-2 border-slate-300 border-t-orange-400 rounded-full animate-spin" />
              Loading calls…
            </div>
          ) : physicians.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
              <Users className="w-8 h-8 text-slate-300" />
              <p className="text-sm">No face-to-face or telephonic calls recorded for this date.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Physician</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Specialty</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Segment</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">State</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Score</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Readiness</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Channel</th>
                    <th className="sticky right-0 bg-slate-50/80 px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide shadow-[-1px_0_0_0_#e2e8f0]">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {physicians.map(p => {
                    const hasScore = p.OVERALL_SCORE != null && !isNaN(Number(p.OVERALL_SCORE));
                    const existingNote = notes[p.PHYSICIAN_ID] ?? null;
                    const isExpanded = expandedRow === p.PHYSICIAN_ID;
                    const channel = p.PROMOTION_CHANNEL ?? '';
                    const channelIcon = channel.toLowerCase().includes('telephonic')
                      ? <Phone className="w-3 h-3 shrink-0" />
                      : <Users className="w-3 h-3 shrink-0" />;

                    return (
                      <>
                        <tr
                          key={p.PHYSICIAN_ID}
                          className={`group border-b border-slate-100 transition-colors ${isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50/70'}`}
                        >
                          <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                            Dr. {p.FIRST_NAME} {p.LAST_NAME}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{p.SPECIALTY ?? <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-3 text-slate-600">{p.SEGMENT_NAME ?? <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-3 text-slate-600">{p.STATE ?? <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-3 text-slate-700 font-semibold text-center">
                            {hasScore ? Number(p.OVERALL_SCORE).toFixed(1) : <span className="text-slate-300 font-normal text-sm">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {p.FIELD_READINESS
                              ? <span className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap" style={readinessBadge(p.FIELD_READINESS)}>{p.FIELD_READINESS}</span>
                              : <span className="text-slate-300 text-sm">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-1.5 text-slate-500 text-xs">
                              {channelIcon}{channel}
                            </span>
                          </td>
                          <td className="sticky right-0 bg-white group-hover:bg-slate-50/70 px-4 py-2.5 shadow-[-1px_0_0_0_#e2e8f0] transition-colors">
                            <button
                              onClick={() => setExpandedRow(isExpanded ? null : p.PHYSICIAN_ID)}
                              className="h-9 px-4 rounded-full flex items-center gap-2 border text-sm font-medium transition-all whitespace-nowrap"
                              style={
                                hoveredBtn === p.PHYSICIAN_ID
                                  ? { background: 'linear-gradient(135deg, #FF6B00, #00C8FF)', color: 'white', borderColor: 'transparent' }
                                  : isExpanded
                                  ? { background: 'linear-gradient(135deg, #FF6B00, #00C8FF)', color: 'white', borderColor: 'transparent' }
                                  : { borderColor: '#e2e8f0', background: 'white', color: '#64748b' }
                              }
                              onMouseEnter={() => setHoveredBtn(p.PHYSICIAN_ID)}
                              onMouseLeave={() => setHoveredBtn(null)}
                            >
                              <Mic className="w-3.5 h-3.5 shrink-0" />
                              {existingNote ? 'Edit Notes' : 'Record Notes'}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${p.PHYSICIAN_ID}-expanded`} className="border-b border-slate-100">
                            <td colSpan={8} className="p-0">
                              <NoteRow
                                physician={p}
                                existingNote={existingNote}
                                onSaved={(note) => handleNoteSaved(p.PHYSICIAN_ID, note)}
                                onClose={() => setExpandedRow(null)}
                              />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
