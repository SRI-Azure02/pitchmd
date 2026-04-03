'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Mic, MicOff, Send, Edit2, ArrowLeft, Phone, Users, PlusCircle,
} from 'lucide-react';

// ── US Federal Holidays 2025–2027 ─────────────────────────────────────────────
const US_HOLIDAYS = new Set([
  '2025-01-01','2025-01-20','2025-02-17','2025-05-26','2025-06-19',
  '2025-07-04','2025-09-01','2025-10-13','2025-11-11','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-05-25','2026-06-19',
  '2026-07-04','2026-09-07','2026-10-12','2026-11-11','2026-11-26','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-05-31','2027-06-19',
  '2027-07-05','2027-09-06','2027-10-11','2027-11-11','2027-11-25','2027-12-24',
]);

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getWeekDays(anchor: Date): Date[] {
  const dow = anchor.getDay();
  const mon = new Date(anchor);
  mon.setDate(anchor.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: 5 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate()+i); return d; });
}

function getMonthWeekdays(anchor: Date): Date[] {
  const year = anchor.getFullYear(), month = anchor.getMonth();
  const days: Date[] = [];
  for (let d = new Date(year, month, 1); d.getMonth() === month; d.setDate(d.getDate()+1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) days.push(new Date(d));
  }
  return days;
}

const MONTH_NAMES = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
const DAY_ABBR = ['Mon','Tue','Wed','Thu','Fri'];

function readinessBadge(r: string): React.CSSProperties {
  const s = r?.toLowerCase() ?? '';
  if (s.includes('field')) return { background: '#dcfce7', color: '#15803d' };
  if (s.includes('almost') || s.includes('developing')) return { background: '#fef9c3', color: '#854d0e' };
  return { background: '#fee2e2', color: '#b91c1c' };
}

// ── Voice recorder hook ───────────────────────────────────────────────────────
interface RecorderState { recording: boolean; transcript: string; interim: string; waveData: number[]; }

function useVoiceRecorder(onFinalTranscript: (t: string) => void) {
  const [state, setState] = useState<RecorderState>({ recording: false, transcript: '', interim: '', waveData: [] });
  const recRef = useRef<any>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const finalRef = useRef('');

  const stopWaveform = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (ctxRef.current) { ctxRef.current.close(); ctxRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setState(s => ({ ...s, waveData: [] }));
  }, []);

  const startWaveform = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext(); ctxRef.current = ctx;
      const analyser = ctx.createAnalyser(); analyser.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        setState(s => ({ ...s, waveData: Array.from(buf.slice(0, 24)) }));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch { /* mic denied */ }
  }, []);

  const start = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    finalRef.current = '';
    const r = new SR(); recRef.current = r;
    r.continuous = true; r.interimResults = true; r.lang = 'en-US';
    r.onresult = (e: any) => {
      let interim = '', final = finalRef.current;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += (final ? ' ' : '') + t.trim();
        else interim += t;
      }
      finalRef.current = final;
      setState(s => ({ ...s, transcript: final, interim }));
    };
    r.onerror = () => stop();
    r.onend = () => { setState(s => ({ ...s, recording: false, interim: '' })); stopWaveform(); };
    r.start();
    setState(s => ({ ...s, recording: true, transcript: '', interim: '' }));
    startWaveform();
  }, [startWaveform, stopWaveform]);

  const stop = useCallback(() => {
    if (recRef.current) { try { recRef.current.stop(); } catch {} recRef.current = null; }
    stopWaveform();
    setState(s => ({ ...s, recording: false, interim: '' }));
    if (finalRef.current) onFinalTranscript(finalRef.current);
  }, [stopWaveform, onFinalTranscript]);

  return { state, start, stop };
}

// ── Waveform ──────────────────────────────────────────────────────────────────
function Waveform({ data }: { data: number[] }) {
  return (
    <div className="flex items-center gap-0.5 h-7">
      {Array.from({ length: 24 }, (_, i) => {
        const h = data.length ? Math.max(3, Math.round((data[i] / 255) * 28)) : 3;
        return (
          <div key={i} className="w-1 rounded-full transition-all duration-75"
            style={{ height: h, background: data.length ? 'linear-gradient(to top,#FF6B00,#00C8FF)' : '#e2e8f0' }} />
        );
      })}
    </div>
  );
}

// ── Note recorder row ─────────────────────────────────────────────────────────
interface NoteRowProps { physician: any; existingNote: any | null; callDate: string; onSaved: (note: any) => void; onClose: () => void; }

function NoteRow({ physician, existingNote, callDate, onSaved, onClose }: NoteRowProps) {
  const [editText, setEditText] = useState(existingNote?.TRANSCRIPT ?? '');
  const [editing, setEditing] = useState(!existingNote);
  const [summary, setSummary] = useState(existingNote?.AI_SUMMARY ?? '');
  const [saving, setSaving] = useState(false);
  const [noteId] = useState(existingNote?.NOTE_ID ?? null);

  const handleFinal = useCallback((t: string) => setEditText(prev => prev ? prev + ' ' + t : t), []);
  const recorder = useVoiceRecorder(handleFinal);

  const handleSubmit = async () => {
    const text = editText.trim(); if (!text) return;
    setSaving(true);
    try {
      const sumRes = await fetch('/api/call-journal/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: text }) });
      const { summary: aiSummary } = await sumRes.json();
      setSummary(aiSummary ?? '');
      const callTimestamp = new Date().toISOString();
      if (noteId) {
        await fetch('/api/call-journal/notes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteId, transcript: text, aiSummary: aiSummary ?? '' }) });
      } else {
        await fetch('/api/call-journal/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ physicianId: physician.PHYSICIAN_ID, callDate, callTimestamp, transcript: text, aiSummary: aiSummary ?? '' }) });
      }
      setEditing(false);
      onSaved({ NOTE_ID: noteId, TRANSCRIPT: text, AI_SUMMARY: aiSummary ?? '', CALL_TIMESTAMP: callTimestamp });
    } catch (err) { console.error('[note-row] save error:', err); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 space-y-3">
      {editing && (
        <div className="flex items-center gap-4">
          <button onClick={recorder.state.recording ? recorder.stop : recorder.start}
            className={`flex items-center gap-2 h-9 px-4 rounded-full text-sm font-medium transition-all ${recorder.state.recording ? 'bg-red-500 text-white hover:bg-red-600' : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
            {recorder.state.recording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            {recorder.state.recording ? 'Stop recording' : 'Start recording'}
          </button>
          <Waveform data={recorder.state.waveData} />
        </div>
      )}
      {recorder.state.recording && recorder.state.interim && (
        <p className="text-xs text-slate-400 italic truncate">{recorder.state.interim}</p>
      )}
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
      {!editing && summary && (
        <div className="flex items-start gap-2 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
          <span className="text-xs font-semibold text-orange-600 shrink-0 mt-0.5">AI Summary</span>
          <p className="text-xs text-orange-800 leading-relaxed">{summary}</p>
        </div>
      )}
      <div className="flex items-center gap-2 justify-end">
        <button onClick={onClose} className="h-8 px-3 rounded-full text-xs text-slate-500 hover:bg-slate-200 transition-colors">Close</button>
        {!editing && <button onClick={() => setEditing(true)} className="h-8 px-3 rounded-full flex items-center gap-1.5 text-xs border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"><Edit2 className="w-3 h-3" /> Edit</button>}
        {editing && (
          <button onClick={handleSubmit} disabled={saving || !editText.trim()}
            className="h-8 px-4 rounded-full flex items-center gap-1.5 text-xs font-medium text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#FF6B00,#00C8FF)' }}>
            <Send className="w-3 h-3" />{saving ? 'Saving…' : 'Submit'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Physician picker (manual add) ─────────────────────────────────────────────
interface PhysicianPickerProps { onSelect: (p: any) => void; onClose: () => void; }

function PhysicianPicker({ onSelect, onClose }: PhysicianPickerProps) {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/physicians')
      .then(r => r.json())
      .then(d => setList(d.physicians ?? d ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = list.filter(p => {
    const name = `${p.FIRST_NAME} ${p.LAST_NAME}`.toLowerCase();
    return name.includes(search.toLowerCase()) || (p.SPECIALTY ?? '').toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/80">
        <span className="text-sm font-semibold text-slate-700">Select a Physician</span>
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Cancel</button>
      </div>
      <div className="px-4 py-2 border-b border-slate-100">
        <input
          className="w-full text-sm px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-200"
          placeholder="Search by name or specialty…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-10 gap-2 text-slate-400 text-sm">
          <div className="w-4 h-4 border-2 border-slate-200 border-t-orange-400 rounded-full animate-spin" /> Loading…
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
          {filtered.map(p => (
            <button key={p.PHYSICIAN_ID} onClick={() => onSelect(p)}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors text-left">
              <div>
                <p className="text-sm font-semibold text-slate-800">Dr. {p.FIRST_NAME} {p.LAST_NAME}</p>
                <p className="text-xs text-slate-400">{p.SPECIALTY ?? ''}{p.SEGMENT_NAME ? ` · ${p.SEGMENT_NAME}` : ''}</p>
              </div>
              <PlusCircle className="w-4 h-4 text-orange-400 shrink-0" />
            </button>
          ))}
          {!filtered.length && <p className="px-4 py-6 text-center text-sm text-slate-400">No physicians found</p>}
        </div>
      )}
    </div>
  );
}

// ── Physician table ───────────────────────────────────────────────────────────
interface PhysicianTableProps {
  physicians: any[];
  notes: Record<string, any>;
  expandedRow: string | null;
  callDate: string;
  onToggleRow: (id: string) => void;
  onNoteSaved: (id: string, note: any) => void;
}

function PhysicianTable({ physicians, notes, expandedRow, callDate, onToggleRow, onNoteSaved }: PhysicianTableProps) {
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

  return (
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
            const channel = p.PROMOTION_CHANNEL ?? 'Manual';
            const isTelephonic = channel.toLowerCase().includes('telephonic');

            return (
              <>
                <tr key={p.PHYSICIAN_ID}
                  className={`group border-b border-slate-100 transition-colors ${isExpanded ? 'bg-slate-50' : 'hover:bg-slate-100/70'}`}>
                  <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">Dr. {p.FIRST_NAME} {p.LAST_NAME}</td>
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
                      {isTelephonic ? <Phone className="w-3 h-3 shrink-0" /> : <Users className="w-3 h-3 shrink-0" />}
                      {channel}
                    </span>
                  </td>
                  <td className="sticky right-0 bg-white group-hover:bg-slate-100/70 px-4 py-2.5 shadow-[-1px_0_0_0_#e2e8f0] transition-colors">
                    <button
                      onClick={() => onToggleRow(p.PHYSICIAN_ID)}
                      className="h-9 px-4 rounded-full flex items-center gap-2 border text-sm font-medium transition-all whitespace-nowrap"
                      style={hoveredBtn === p.PHYSICIAN_ID || isExpanded
                        ? { background: 'linear-gradient(135deg,#FF6B00,#00C8FF)', color: 'white', borderColor: 'transparent' }
                        : { borderColor: '#e2e8f0', background: 'white', color: '#64748b' }}
                      onMouseEnter={() => setHoveredBtn(p.PHYSICIAN_ID)}
                      onMouseLeave={() => setHoveredBtn(null)}
                    >
                      <Mic className="w-3.5 h-3.5 shrink-0" />
                      {existingNote ? 'Edit Notes' : 'Record Notes'}
                    </button>
                  </td>
                </tr>
                {isExpanded && (
                  <tr key={`${p.PHYSICIAN_ID}-exp`} className="border-b border-slate-100">
                    <td colSpan={8} className="p-0">
                      <NoteRow
                        physician={p}
                        existingNote={existingNote}
                        callDate={callDate}
                        onSaved={(note) => onNoteSaved(p.PHYSICIAN_ID, note)}
                        onClose={() => onToggleRow(p.PHYSICIAN_ID)}
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
  );
}

// ── Main CallJournal ──────────────────────────────────────────────────────────
interface CallJournalProps { username: string; onBack: () => void; }

export default function CallJournal({ username, onBack }: CallJournalProps) {
  const today = new Date(); today.setHours(0,0,0,0);

  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [monthExpanded, setMonthExpanded] = useState(false);
  const [monthAnchor, setMonthAnchor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  // Activity date highlighting
  const [activityDates, setActivityDates] = useState<Set<string>>(new Set());

  // Physician data for selected day
  const [physicians, setPhysicians] = useState<any[]>([]);
  const [manualPhysicians, setManualPhysicians] = useState<any[]>([]);
  const [loadingPhysicians, setLoadingPhysicians] = useState(false);
  const [notes, setNotes] = useState<Record<string, any>>({});
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const weekDays = getWeekDays(today);
  const monthDays = monthExpanded ? getMonthWeekdays(monthAnchor) : [];

  // Load activity dates for visible range (week + current month view)
  useEffect(() => {
    const from = toIso(weekDays[0]);
    const to = monthExpanded
      ? toIso(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth()+1, 0))
      : toIso(weekDays[4]);
    fetch(`/api/call-journal/activity?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(d => setActivityDates(new Set(d.dates ?? [])))
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthExpanded, monthAnchor]);

  // Also reload activity dates when month view navigates
  useEffect(() => {
    if (!monthExpanded) return;
    const from = toIso(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1));
    const to   = toIso(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth()+1, 0));
    fetch(`/api/call-journal/activity?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(d => setActivityDates(new Set(d.dates ?? [])))
      .catch(console.error);
  }, [monthExpanded, monthAnchor]);

  // Load physicians + notes for selected date
  useEffect(() => {
    const iso = toIso(selectedDate);
    setPhysicians([]); setManualPhysicians([]); setNotes({}); setExpandedRow(null); setShowPicker(false);
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

  const allPhysicians = [...physicians, ...manualPhysicians];
  const callDate = toIso(selectedDate);

  const handleToggleRow = (id: string) => setExpandedRow(prev => prev === id ? null : id);
  const handleNoteSaved = (id: string, note: any) => setNotes(prev => ({ ...prev, [id]: note }));

  const handlePickerSelect = (p: any) => {
    if (!allPhysicians.find(x => x.PHYSICIAN_ID === p.PHYSICIAN_ID)) {
      setManualPhysicians(prev => [...prev, { ...p, PROMOTION_CHANNEL: 'Manual' }]);
    }
    setShowPicker(false);
    setExpandedRow(p.PHYSICIAN_ID);
  };

  // ── Date button helpers ───────────────────────────────────────────────────
  const isSelectable = (d: Date) => d <= today;
  const isHoliday    = (d: Date) => US_HOLIDAYS.has(toIso(d));
  const isToday      = (d: Date) => toIso(d) === toIso(today);
  const isSelected   = (d: Date) => toIso(d) === callDate;
  const hasActivity  = (d: Date) => activityDates.has(toIso(d));

  // Week button: circle with small abbr + number
  const renderWeekBtn = (d: Date) => {
    const sel = isSelected(d); const sel_ok = isSelectable(d);
    const holiday = isHoliday(d); const activity = hasActivity(d);
    const abbr = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];

    let cls = 'flex flex-col items-center justify-center w-12 h-12 rounded-full border transition-all ';
    let style: React.CSSProperties = {};
    if (!sel_ok) { cls += 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'; }
    else if (sel) { cls += 'text-white border-transparent'; style = { background: 'linear-gradient(135deg,#FF6B00,#00C8FF)' }; }
    else if (holiday) { cls += 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 cursor-pointer'; }
    else if (isToday(d)) { cls += 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200 cursor-pointer'; }
    else { cls += 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 cursor-pointer'; }

    return (
      <button key={toIso(d)} disabled={!sel_ok} onClick={() => sel_ok && setSelectedDate(new Date(d))}
        className={`relative ${cls}`} style={style}>
        <span className="text-[9px] font-medium uppercase tracking-wide leading-none">{abbr}</span>
        <span className="text-sm font-bold leading-tight">{d.getDate()}</span>
        {/* Activity dot */}
        {activity && !sel && (
          <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-emerald-400" />
        )}
        {/* Holiday dot */}
        {holiday && !sel && (
          <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
        )}
      </button>
    );
  };

  // Month button: smaller circle, number only
  const renderMonthBtn = (d: Date) => {
    const sel = isSelected(d); const sel_ok = isSelectable(d);
    const holiday = isHoliday(d); const activity = hasActivity(d);

    let cls = 'relative flex items-center justify-center w-9 h-9 rounded-full border text-sm font-semibold transition-all ';
    let style: React.CSSProperties = {};
    if (!sel_ok) { cls += 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'; }
    else if (sel) { cls += 'text-white border-transparent'; style = { background: 'linear-gradient(135deg,#FF6B00,#00C8FF)' }; }
    else if (holiday) { cls += 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 cursor-pointer'; }
    else if (isToday(d)) { cls += 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200 cursor-pointer'; }
    else if (activity) { cls += 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 cursor-pointer'; }
    else { cls += 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 cursor-pointer'; }

    return (
      <button key={toIso(d)} disabled={!sel_ok} onClick={() => sel_ok && setSelectedDate(new Date(d))}
        className={cls} style={style} title={toIso(d)}>
        {d.getDate()}
        {holiday && !sel && <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-amber-400" />}
      </button>
    );
  };

  const selectedLabel = selectedDate.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });

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
          <div className="flex items-center gap-2">{weekDays.map(renderWeekBtn)}</div>
          <button onClick={() => setMonthExpanded(v => !v)}
            className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 shrink-0 transition-colors"
            title={monthExpanded ? 'Collapse' : 'Expand to month'}>
            {monthExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Month grid */}
        {monthExpanded && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth()-1, 1))}
                className="p-1 hover:bg-slate-100 rounded-full transition-colors">
                <ChevronLeft className="w-4 h-4 text-slate-400" />
              </button>
              <span className="text-sm font-semibold text-slate-700">{MONTH_NAMES[monthAnchor.getMonth()]} {monthAnchor.getFullYear()}</span>
              <button onClick={() => setMonthAnchor(d => new Date(d.getFullYear(), d.getMonth()+1, 1))}
                disabled={new Date(monthAnchor.getFullYear(), monthAnchor.getMonth()+1, 1) > today}
                className="p-1 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            {/* Column headers */}
            <div className="grid grid-cols-5 gap-1 mb-1">
              {DAY_ABBR.map(a => <div key={a} className="text-center text-[10px] font-medium text-slate-400 uppercase tracking-wide py-0.5">{a}</div>)}
            </div>
            {/* Day buttons */}
            <div className="grid grid-cols-5 gap-1">
              {monthDays.map(renderMonthBtn)}
            </div>
            {/* Legend */}
            <div className="flex items-center gap-4 mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Has calls</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> US Holiday</span>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-5xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">{selectedLabel}</h2>
              <p className="text-xs text-slate-400 mt-0.5">Face-to-face and telephonic calls</p>
            </div>
            {/* Add call button always visible */}
            {!loadingPhysicians && (
              <button onClick={() => setShowPicker(v => !v)}
                className="h-9 px-4 rounded-full flex items-center gap-2 text-sm font-medium border transition-all"
                style={showPicker
                  ? { background:'linear-gradient(135deg,#FF6B00,#00C8FF)', color:'white', borderColor:'transparent' }
                  : { background:'white', color:'#64748b', borderColor:'#e2e8f0' }}>
                <PlusCircle className="w-4 h-4 shrink-0" />
                Add Call
              </button>
            )}
          </div>

          {/* Physician picker dropdown */}
          {showPicker && <PhysicianPicker onSelect={handlePickerSelect} onClose={() => setShowPicker(false)} />}

          {loadingPhysicians ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2">
              <div className="w-4 h-4 border-2 border-slate-300 border-t-orange-400 rounded-full animate-spin" /> Loading calls…
            </div>
          ) : allPhysicians.length === 0 && !showPicker ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
              <Users className="w-8 h-8 text-slate-300" />
              <p className="text-sm">No face-to-face or telephonic calls recorded for this date.</p>
              <button onClick={() => setShowPicker(true)}
                className="h-9 px-5 rounded-full flex items-center gap-2 text-sm font-medium text-white"
                style={{ background: 'linear-gradient(135deg,#FF6B00,#00C8FF)' }}>
                <PlusCircle className="w-4 h-4" /> Add a Call Entry
              </button>
            </div>
          ) : allPhysicians.length > 0 ? (
            <PhysicianTable
              physicians={allPhysicians}
              notes={notes}
              expandedRow={expandedRow}
              callDate={callDate}
              onToggleRow={handleToggleRow}
              onNoteSaved={handleNoteSaved}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
