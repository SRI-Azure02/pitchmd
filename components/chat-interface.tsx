'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import AudioInput from './audio-input';
import EvaluationPanel from './evaluation-panel';
import { Send, RotateCcw, Square, Volume2, VolumeX, Video, VideoOff, MessageSquare, Search, ChevronDown, X, Check, BarChart2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { parseEmotion, speakText, stopCurrentAudio } from '@/lib/elevenlabs';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isEvaluation?: boolean;
}


function randomSessionDuration(min = 60, max = 150): number {
  const r1 = Math.random();
  const r2 = Math.random();
  return Math.round(min + ((r1 + r2) / 2) * (max - min));
}

// ── Physician list helpers ─────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';
type SortConfig = { field: string; dir: SortDir } | null;
type FilterMap = { segment: string | null; specialty: string | null; overallScore: string | null; fieldReadiness: string | null };

function scoreBucket(score: number | null | undefined): string {
  if (score == null) return 'Not Evaluated';
  if (score < 6)  return '< 6';
  if (score < 8)  return '6–7.9';
  if (score < 9)  return '8–8.9';
  return '9+';
}

function physicianSortValue(p: any, field: string): any {
  switch (field) {
    case 'name':          return `${p.LAST_NAME ?? ''} ${p.FIRST_NAME ?? ''}`.trim().toLowerCase();
    case 'specialty':     return (p.SPECIALTY        ?? '').toLowerCase();
    case 'segment':       return (p.SEGMENT_NAME    ?? '').toLowerCase();
    case 'state':         return (p.STATE            ?? '').toLowerCase();
    case 'overallScore':  return p.OVERALL_SCORE  ?? -1;
    case 'fieldReadiness':return (p.FIELD_READINESS ?? '').toLowerCase();
    default:              return '';
  }
}

// ── Physician filter dropdown ──────────────────────────────────────────────

interface FilterDropdownProps {
  label: string;
  field: string;
  options: string[];
  sortType: 'alpha' | 'numeric';
  activeFilter: string | null;
  sortConfig: SortConfig;
  onFilter: (val: string | null) => void;
  onSort: (dir: SortDir) => void;
  isOpen: boolean;
  onToggle: () => void;
}

function PhysicianFilterDropdown({
  label, field, options, sortType,
  activeFilter, sortConfig, onFilter, onSort, isOpen, onToggle,
}: FilterDropdownProps) {
  const isThisSorted = sortConfig?.field === field;
  const isActive = !!activeFilter || isThisSorted;
  const asc  = sortType === 'alpha' ? 'A → Z' : 'Low → High';
  const desc = sortType === 'alpha' ? 'Z → A' : 'High → Low';

  return (
    <div className="relative">
      {isOpen && <div className="fixed inset-0 z-40" onClick={onToggle} />}
      <button
        onClick={onToggle}
        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
          isActive
            ? 'border-blue-400 bg-blue-50 text-blue-700'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        {label}
        {isActive && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 ml-0.5" />}
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg min-w-[190px] py-1 overflow-hidden">
          {/* Sort options */}
          <button
            onClick={() => { onSort('asc'); onToggle(); }}
            className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 ${isThisSorted && sortConfig?.dir === 'asc' ? 'text-blue-600 font-medium' : 'text-slate-700'}`}
          >
            ↑ {asc}
            {isThisSorted && sortConfig?.dir === 'asc' && <Check className="w-3 h-3" />}
          </button>
          <button
            onClick={() => { onSort('desc'); onToggle(); }}
            className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 ${isThisSorted && sortConfig?.dir === 'desc' ? 'text-blue-600 font-medium' : 'text-slate-700'}`}
          >
            ↓ {desc}
            {isThisSorted && sortConfig?.dir === 'desc' && <Check className="w-3 h-3" />}
          </button>

          {options.length > 0 && (
            <>
              <div className="border-t border-slate-100 my-1" />
              <p className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Filter</p>
              <button
                onClick={() => { onFilter(null); onToggle(); }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 ${!activeFilter ? 'text-blue-600 font-medium' : 'text-slate-600'}`}
              >
                All
                {!activeFilter && <Check className="w-3 h-3" />}
              </button>
              {options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => { onFilter(opt); onToggle(); }}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 ${activeFilter === opt ? 'text-blue-600 font-medium bg-blue-50' : 'text-slate-600'}`}
                >
                  <span className="truncate max-w-[140px]">{opt}</span>
                  {activeFilter === opt && <Check className="w-3 h-3 shrink-0" />}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatInterface({ username = 'Rep' }: { username?: string }) {
  const targetDurationRef = useRef<number>(randomSessionDuration());

  // ── Session state ─────────────────────────────────────────────────────────
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [roleplaying, setRoleplaying] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [evalOpen, setEvalOpen] = useState(false);
  const [evalPhysicianId, setEvalPhysicianId] = useState<string | null>(null);
  const [userTyping, setUserTyping] = useState(false);
  const [sessionDuration, setSessionDuration] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [ttsAvailable, setTtsAvailable] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [avatarEnabled, setAvatarEnabled] = useState(false);
  const voiceEnabledRef = useRef(true);

  // ── Physician selection state ─────────────────────────────────────────────
  const [physicianSelectionMode, setPhysicianSelectionMode] = useState(false);
  const [physicians, setPhysicians] = useState<any[]>([]);
  const [physiciansLoading, setPhysiciansLoading] = useState(false);
  const [selectedPhysician, setSelectedPhysician] = useState<{ name: string; specialty: string | null; segment: string | null } | null>(null);

  // ── Physician list filter / sort state ────────────────────────────────────
  const [physicianSearch, setPhysicianSearch] = useState('');
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'overallScore', dir: 'asc' });
  const [filterValues, setFilterValues] = useState<FilterMap>({ segment: null, specialty: null, overallScore: null, fieldReadiness: null });
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [tableTooltip, setTableTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  const inputRef = useRef('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasStarted = useRef(false);
  const autoEndedRef = useRef(false);
  const sessionEndedRef = useRef(false);
  const roleplayingRef = useRef(false);
  const currentVoiceRef = useRef<string | null>(null);
  // Physician ID extracted from the agent's planning response; used to call
  // REPEVAL directly so we don't depend on the Cortex Agent invoking it.
  const physicianIdRef = useRef<string | null>(null);
  // Prevents double-triggering REPEVAL if both the timer and a manual "done"
  // fire close together.
  // Timestamp (ms) when REPEVAL was fired for the current session.
  // null = not yet triggered. Non-null also acts as the "already fired" guard.
  const evalStartedAtRef = useRef<number | null>(null);
  const sendMessageRef = useRef<(text: string, history: Message[]) => Promise<void>>(
    async () => { },
  );

  // ── Sync state → refs ─────────────────────────────────────────────────────
  useEffect(() => { inputRef.current = inputValue; }, [inputValue]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { sessionEndedRef.current = sessionEnded; }, [sessionEnded]);
  useEffect(() => { voiceEnabledRef.current = voiceEnabled; }, [voiceEnabled]);

  // ── Auto-resize textarea ───────────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [inputValue]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, statusMessage]);

  // ── Countdown timer ───────────────────────────────────────────────────────
  // Pauses automatically when loading=true (waiting for agent response).
  // Resumes when loading flips back to false.
  useEffect(() => {
    if (
      !roleplaying ||
      sessionEnded ||
      loading ||
      timeRemaining === null ||
      timeRemaining <= 0
    ) {
      return;
    }
    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null || prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleplaying, sessionEnded, loading]);

  // ── Timer expiry → auto-end session ──────────────────────────────────────
  useEffect(() => {
    if (
      timeRemaining === 0 &&
      sessionDuration !== null &&
      !loading &&
      !autoEndedRef.current &&
      !sessionEndedRef.current
    ) {
      autoEndedRef.current = true;
      sendMessageRef.current('done', messagesRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRemaining, sessionDuration, loading]);

  // ── triggerEvaluation ─────────────────────────────────────────────────────
  // Two-phase approach:
  //   Phase 1 — fire REPEVAL (stored proc runs in background, ~60-120 s).
  //             Show "generating" message in chat immediately.
  //   Phase 2 — poll /api/evaluation every 5 s. Accept only a result whose
  //             PHYSICIAN_ID matches this session AND whose EVALUATED_AT
  //             differs from the baseline (the last result before we fired).
  //             When found, add "ready" message with View Report button.
  //             Never auto-opens the panel — user clicks the button.
  const triggerEvaluation = async (history: Message[]) => {
    // ── Guard ──────────────────────────────────────────────────────────────
    const physicianId = physicianIdRef.current;
    console.log(`[eval] triggerEvaluation — physician=${physicianId}, alreadyFired=${evalStartedAtRef.current !== null}`);
    if (evalStartedAtRef.current !== null) return;
    if (!physicianId) {
      setMessages((prev) => [...prev, {
        id: `msg_${Date.now()}_eval_err`,
        role: 'assistant' as const,
        content: '⚠️ Could not start evaluation: no physician ID recorded. Please start a new session.',
      }]);
      return;
    }

    const transcript = history
      .filter((m) => !m.isEvaluation)
      .map((m) => `${m.role === 'user' ? 'Rep' : 'Physician'}: ${m.content}`)
      .join('\n');

    if (!transcript.trim()) {
      console.warn('[eval] empty transcript — skipping');
      return;
    }

    evalStartedAtRef.current = Date.now();

    // ── Show "generating" message immediately ────────────────────────────────
    setMessages((prev) => [...prev, {
      id: `msg_${Date.now()}_eval_pending`,
      role: 'assistant' as const,
      content: 'Your evaluation report is being generated. This typically takes 1–3 minutes — please wait.',
    }]);

    // ── Call /api/evaluation/submit and AWAIT its response.
    //    The route now awaits REPEVAL to completion before returning 200.
    //    No DB polling needed — when this fetch resolves, the result is in the DB.
    try {
      console.log(`[eval] calling /api/evaluation/submit — physician=${physicianId}`);
      const res = await fetch('/api/evaluation/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ physicianId, transcript }),
      });

      if (res.ok) {
        console.log('[eval] ✅ REPEVAL completed — showing report button');
        setMessages((prev) => [...prev, {
          id: `msg_${Date.now()}_eval_ready`,
          role: 'assistant' as const,
          content: 'Your evaluation report is ready.',
          isEvaluation: true,
        }]);
      } else {
        const errBody = await res.json().catch(() => ({}));
        const errMsg = (errBody as any)?.error || `HTTP ${res.status}`;
        console.error(`[eval] REPEVAL failed — ${errMsg}`);
        setMessages((prev) => [...prev, {
          id: `msg_${Date.now()}_eval_err`,
          role: 'assistant' as const,
          content: `⚠️ Evaluation failed: ${errMsg}. Please try again.`,
          isEvaluation: true,
        }]);
      }
    } catch (e: any) {
      console.error('[eval] network error:', e?.message);
      setMessages((prev) => [...prev, {
        id: `msg_${Date.now()}_eval_err`,
        role: 'assistant' as const,
        content: '⚠️ Network error during evaluation. Please check your connection and try again.',
        isEvaluation: true,
      }]);
    }
  };

  // ── sendMessage ───────────────────────────────────────────────────────────
  const sendMessage = async (text: string, history: Message[]) => {
    if (sessionEndedRef.current) return;

    const isDone = ['done', 'end', 'finish', 'bye', 'have a good day'].includes(
      text.trim().toLowerCase(),
    );
    if (isDone) {
      sessionEndedRef.current = true;
      setSessionEnded(true);
      setTimeRemaining(null);
      stopCurrentAudio();

      // Trigger REPEVAL directly — don't rely on the Cortex Agent to call it.
      // history is the conversation BEFORE "done", which is what REPEVAL needs.
      triggerEvaluation(history);
    }

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: text,
    };
    const updatedMessages = [...history, userMessage];
    setMessages(updatedMessages);
    messagesRef.current = updatedMessages;
    setInputValue('');
    inputRef.current = '';
    setUserTyping(false);
    setLoading(true);
    setStatusMessage('Connecting...');
    stopCurrentAudio();

    try {
      const HEAD = Math.min(3, updatedMessages.length);
      const headIds = new Set(updatedMessages.slice(0, HEAD).map((m) => m.id));
      const tail = updatedMessages.slice(-6);
      const contextMessages =
        updatedMessages.length > 9
          ? [
            ...updatedMessages.slice(0, HEAD),
            ...tail.filter((m) => !headIds.has(m.id)),
          ]
          : updatedMessages;

      const response = await fetch('/api/cortex/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: contextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok || !response.body) throw new Error('Failed to connect to agent');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line.trim());

            if (event.type === 'status') {
              setStatusMessage(event.message);

            } else if (event.type === 'done') {
              console.log('[debug] done event text:', event.text?.slice(0, 400));
              // Agent planning responses are suppressed server-side; skip chat bubble
              // but still process sessionDuration/voiceModel/physicianId metadata.
              if (event.suppressed === true) {
                console.log('[debug] suppressed planning response — skipping bubble');
                // The planning block contains the PHYSICIAN_ID — capture it now
                // so we can call REPEVAL directly at session end.
                if (event.physicianId && !physicianIdRef.current) {
                  physicianIdRef.current = event.physicianId;
                  console.log('[eval] physician ID captured:', event.physicianId);
                }
                setLoading(false);
                setStatusMessage('');
                continue;
              }
              const isEval = event.isEvaluation === true;

              // ── FIX: Read metadata from event fields, not from stripped text ──
              // The route strips [SESSION_DURATION:] and [VOICE_MODEL:] from the
              // display text (they appear before [EMOTION:] and extractRoleplay()
              // discards everything before the first emotion tag). We now pass
              // these values explicitly as event.sessionDuration and event.voiceModel
              // so they survive the text-processing pipeline intact.
              const duration: number | null = event.sessionDuration ?? null;
              const voiceModel: string | null = event.voiceModel ?? null;

              // Capture voice model on first occurrence and use it to look up
              // the physician ID — fallback for when the agent doesn't emit a
              // planning block containing PHYSICIAN_ID.
              if (voiceModel && !currentVoiceRef.current) {
                currentVoiceRef.current = voiceModel;
                console.log('[tts] voice model assigned:', voiceModel);

                if (!physicianIdRef.current) {
                  fetch(`/api/physicians/by-voice-model?model=${encodeURIComponent(voiceModel)}`)
                    .then((r) => r.json())
                    .then((data) => {
                      if (data.physicianId && !physicianIdRef.current) {
                        physicianIdRef.current = data.physicianId;
                        console.log('[eval] physician ID from voice model lookup:', data.physicianId);
                      }
                    })
                    .catch((err) => console.warn('[eval] voice model lookup failed:', err));
                }
              }

              // Start timer on first roleplay message (identified by presence of
              // sessionDuration or voiceModel — neither appears in physician-list responses)
              if (!roleplayingRef.current && (duration !== null || voiceModel !== null)) {
                roleplayingRef.current = true;
                const resolvedDuration =
                  duration !== null && duration >= 30 && duration <= 300
                    ? duration
                    : targetDurationRef.current;

                console.log('[timer] roleplay started — duration:', resolvedDuration, 's');

                setRoleplaying(true);
                setSessionDuration(resolvedDuration);
                setTimeRemaining(resolvedDuration);
              }

              const { emotion, cleanText: emotionStripped } = parseEmotion(event.text);

              if (isEval) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `msg_${Date.now()}_assistant`,
                    role: 'assistant',
                    content: 'Your evaluation is ready.',
                    isEvaluation: true,
                  },
                ]);
                setTimeRemaining(null);
                // Evaluation panel is opened by triggerEvaluation's poller
                // once fresh results appear in the DB. No direct open here.
              } else {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `msg_${Date.now()}_assistant`,
                    role: 'assistant',
                    content: emotionStripped,
                  },
                ]);

                // Only speak during active roleplay, with a voice model assigned,
                // and only when voice is currently enabled (ref avoids stale closure).
                if (roleplayingRef.current && currentVoiceRef.current && voiceEnabledRef.current) {
                  console.log(
                    '[tts] speaking | voice:', currentVoiceRef.current,
                    '| emotion:', emotion,
                  );
                  speakText(emotionStripped, currentVoiceRef.current, emotion).catch(
                    (err) => {
                      console.error('[tts] failed:', err);
                      setTtsAvailable(false);
                    },
                  );
                }
              }

              setStatusMessage('');
              setLoading(false);

            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch (e: any) {
            if (e.message && !e.message.includes('JSON')) throw e;
          }
        }
      }
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_${Date.now()}_error`,
          role: 'assistant',
          content: `Sorry, something went wrong: ${error.message}. Please try again.`,
        },
      ]);
      setStatusMessage('');
      setLoading(false);
    }
  };

  sendMessageRef.current = sendMessage;

  // ── Session controls ──────────────────────────────────────────────────────
  const handleStartSession = async () => {
    if (hasStarted.current || physicianSelectionMode) return;
    setPhysicianSelectionMode(true);
    setPhysiciansLoading(true);
    try {
      const res = await fetch('/api/physicians');
      const data = await res.json();
      setPhysicians(data.physicians ?? []);
    } catch (err) {
      console.error('[physicians] fetch failed:', err);
    } finally {
      setPhysiciansLoading(false);
    }
  };

  const handlePhysicianSelect = (physician: any) => {
    const id: string = physician.PHYSICIAN_ID;
    const name = `Dr. ${physician.FIRST_NAME} ${physician.LAST_NAME}`;

    // Lock in physician ID and voice model immediately — no need to wait for
    // the agent's planning block or a separate voice-model lookup.
    physicianIdRef.current = id;
    if (physician.VOICE_MODEL && !currentVoiceRef.current) {
      currentVoiceRef.current = physician.VOICE_MODEL;
    }

    setSelectedPhysician({
      name,
      specialty: physician.SPECIALTY ?? null,
      segment:   physician.SEGMENT_NAME ?? null,
    });
    setPhysicianSelectionMode(false);
    setSessionStarted(true);
    hasStarted.current = true;

    // Tell the agent which physician was selected so it skips list presentation
    // and goes straight to profile fetch + roleplay.
    const firstMessage =
      `My name is ${username}. I have selected ${name} (Physician ID: ${id}). ` +
      `Please skip the physician list and begin the roleplay immediately.`;
    sendMessage(firstMessage, []);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || loading || sessionEnded) return;
    sendMessage(inputValue.trim(), messagesRef.current);
  };

  const handleAutoSubmit = () => {
    if (userTyping || sessionEnded) return;
    const current = inputRef.current.trim();
    if (current && !loading) sendMessage(current, messagesRef.current);
  };

  const handleNewSession = () => {
    stopCurrentAudio();

    sessionEndedRef.current = false;
    autoEndedRef.current = false;
    hasStarted.current = false;
    roleplayingRef.current = false;
    currentVoiceRef.current = null;
    physicianIdRef.current = null;
    evalStartedAtRef.current = null;
    targetDurationRef.current = randomSessionDuration();
    setPhysicianSelectionMode(false);
    setPhysicians([]);
    setSelectedPhysician(null);
    setEvalPhysicianId(null);
    messagesRef.current = [];

    setMessages([]);
    setStatusMessage('');
    setUserTyping(false);
    setInputValue('');
    setSessionEnded(false);
    setRoleplaying(false);
    setSessionDuration(null);
    setTimeRemaining(null);
    setLoading(false);
    setSessionStarted(false);
    setTtsAvailable(true);
  };

  // ── Column header sort ────────────────────────────────────────────────────
  const handleColumnSort = (field: string) => {
    setSortConfig(prev =>
      prev?.field === field
        ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' },
    );
  };

  // ── Derived options for dropdowns ─────────────────────────────────────────
  const uniqueSegments    = useMemo(() => [...new Set(physicians.map(p => p.SEGMENT_NAME).filter(Boolean))].sort() as string[], [physicians]);
  const uniqueSpecialties = useMemo(() => [...new Set(physicians.map(p => p.SPECIALTY).filter(Boolean))].sort() as string[], [physicians]);
  const uniqueReadiness   = useMemo(() => {
    const vals = [...new Set(physicians.map(p => p.FIELD_READINESS).filter(Boolean))].sort() as string[];
    if (physicians.some(p => !p.FIELD_READINESS)) vals.unshift('Not Evaluated');
    return vals;
  }, [physicians]);
  const scoreBucketOptions = useMemo(() => {
    const buckets = new Set(physicians.map(p => scoreBucket(p.OVERALL_SCORE)));
    const order = ['Not Evaluated', '< 6', '6–7.9', '8–8.9', '9+'];
    return order.filter(b => buckets.has(b));
  }, [physicians]);

  // ── Filtered + sorted physician list ──────────────────────────────────────
  const filteredPhysicians = useMemo(() => {
    let result = [...physicians];

    // Text search across all visible attributes
    const q = physicianSearch.trim().toLowerCase();
    if (q) {
      result = result.filter(p =>
        [p.FIRST_NAME, p.LAST_NAME, p.SPECIALTY, p.CITY, p.STATE, p.SEGMENT_NAME, p.FIELD_READINESS]
          .some(v => v?.toLowerCase().includes(q)),
      );
    }

    // Field filters
    if (filterValues.segment)      result = result.filter(p => p.SEGMENT_NAME    === filterValues.segment);
    if (filterValues.specialty)    result = result.filter(p => p.SPECIALTY        === filterValues.specialty);
    if (filterValues.fieldReadiness) {
      if (filterValues.fieldReadiness === 'Not Evaluated')
        result = result.filter(p => !p.FIELD_READINESS);
      else
        result = result.filter(p => p.FIELD_READINESS === filterValues.fieldReadiness);
    }
    if (filterValues.overallScore) {
      if (filterValues.overallScore === 'Not Evaluated')
        result = result.filter(p => p.OVERALL_SCORE == null);
      else
        result = result.filter(p => scoreBucket(p.OVERALL_SCORE) === filterValues.overallScore);
    }

    // Sort
    if (sortConfig) {
      result.sort((a, b) => {
        const va = physicianSortValue(a, sortConfig.field);
        const vb = physicianSortValue(b, sortConfig.field);
        if (va === vb) return 0;
        if (va === '' || va === -1) return 1;
        if (vb === '' || vb === -1) return -1;
        const cmp = va < vb ? -1 : 1;
        return sortConfig.dir === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [physicians, physicianSearch, filterValues, sortConfig]);

  const anyFilterActive = physicianSearch.trim() || sortConfig || Object.values(filterValues).some(Boolean);

  const visibleMessages = messages.filter(
    (m, i) =>
      !(i === 0 && m.role === 'user' && (
        m.content.startsWith("Hello! I'm ready to begin") ||
        m.content.startsWith('My name is') && m.content.includes('Please skip the physician list')
      )),
  );
  const timerRatio =
    timeRemaining !== null && sessionDuration !== null
      ? timeRemaining / sessionDuration
      : null;
  const isLastThird = timerRatio !== null && timerRatio <= 1 / 3;

  // ── Segment badge colour ──────────────────────────────────────────────────
  const segmentStyle = (segment: string): React.CSSProperties => {
    if (segment?.includes('Innovator'))   return { background: '#e0f2fe', color: '#0369a1' };
    if (segment?.includes('Pragmatist')) return { background: '#fef3c7', color: '#92400e' };
    if (segment?.includes('Conservative')) return { background: '#d1fae5', color: '#065f46' };
    return { background: '#f1f5f9', color: '#475569' };
  };

  // ── Pre-session splash ────────────────────────────────────────────────────
  if (!sessionStarted) {
    // Physician selection grid
    if (physicianSelectionMode) {
      return (
        <div className="flex flex-col h-full min-h-0">
          {/* ── Header ──────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-slate-100 shrink-0">
            <div>
              <p className="text-base font-semibold text-slate-900">Select a Physician</p>
              <p className="text-xs text-slate-400">Choose who you'd like to practice with today</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPhysicianSelectionMode(false)} className="text-xs text-slate-400">
              ← Back
            </Button>
          </div>

          {/* ── Filter ribbon ───────────────────────────────────────────── */}
          <div className="shrink-0 px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
            <div className="flex flex-wrap items-center gap-2">
              {/* Search */}
              <div className="relative flex-1 min-w-[180px] max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={physicianSearch}
                  onChange={e => setPhysicianSearch(e.target.value)}
                  placeholder="Search physicians…"
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                />
                {physicianSearch && (
                  <button onClick={() => setPhysicianSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Segment dropdown */}
              <PhysicianFilterDropdown
                label="Segment"
                field="segment"
                options={uniqueSegments}
                sortType="alpha"
                activeFilter={filterValues.segment}
                sortConfig={sortConfig}
                onFilter={val => setFilterValues(prev => ({ ...prev, segment: val }))}
                onSort={dir => setSortConfig({ field: 'segment', dir })}
                isOpen={openDropdown === 'segment'}
                onToggle={() => setOpenDropdown(v => v === 'segment' ? null : 'segment')}
              />

              {/* Specialty dropdown */}
              <PhysicianFilterDropdown
                label="Specialty"
                field="specialty"
                options={uniqueSpecialties}
                sortType="alpha"
                activeFilter={filterValues.specialty}
                sortConfig={sortConfig}
                onFilter={val => setFilterValues(prev => ({ ...prev, specialty: val }))}
                onSort={dir => setSortConfig({ field: 'specialty', dir })}
                isOpen={openDropdown === 'specialty'}
                onToggle={() => setOpenDropdown(v => v === 'specialty' ? null : 'specialty')}
              />

              {/* Overall Score dropdown */}
              <PhysicianFilterDropdown
                label="Overall Score"
                field="overallScore"
                options={scoreBucketOptions}
                sortType="numeric"
                activeFilter={filterValues.overallScore}
                sortConfig={sortConfig}
                onFilter={val => setFilterValues(prev => ({ ...prev, overallScore: val }))}
                onSort={dir => setSortConfig({ field: 'overallScore', dir })}
                isOpen={openDropdown === 'overallScore'}
                onToggle={() => setOpenDropdown(v => v === 'overallScore' ? null : 'overallScore')}
              />

              {/* Field Readiness dropdown */}
              <PhysicianFilterDropdown
                label="Field Readiness"
                field="fieldReadiness"
                options={uniqueReadiness}
                sortType="alpha"
                activeFilter={filterValues.fieldReadiness}
                sortConfig={sortConfig}
                onFilter={val => setFilterValues(prev => ({ ...prev, fieldReadiness: val }))}
                onSort={dir => setSortConfig({ field: 'fieldReadiness', dir })}
                isOpen={openDropdown === 'fieldReadiness'}
                onToggle={() => setOpenDropdown(v => v === 'fieldReadiness' ? null : 'fieldReadiness')}
              />

              {/* Clear all */}
              {anyFilterActive && (
                <button
                  onClick={() => {
                    setPhysicianSearch('');
                    setSortConfig(null);
                    setFilterValues({ segment: null, specialty: null, overallScore: null, fieldReadiness: null });
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>

            {/* Result count */}
            <p className="text-[11px] text-slate-400 mt-1.5">
              {filteredPhysicians.length} of {physicians.length} physician{physicians.length !== 1 ? 's' : ''}
              {anyFilterActive ? ' match your filters' : ''}
            </p>
          </div>

          {/* ── Physician table ──────────────────────────────────────────── */}
          <div className="flex-1 overflow-auto">
            {physiciansLoading ? (
              <div className="flex items-center justify-center h-40 gap-2 text-slate-400">
                <Spinner className="w-4 h-4" />
                <span className="text-sm">Loading physicians...</span>
              </div>
            ) : filteredPhysicians.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-slate-400">
                <p className="text-sm font-medium">No physicians match your filters.</p>
                <button onClick={() => { setPhysicianSearch(''); setFilterValues({ segment: null, specialty: null, overallScore: null, fieldReadiness: null }); setSortConfig(null); }} className="text-xs text-blue-500 hover:underline">Clear filters</button>
              </div>
            ) : (
              <table className="w-full text-sm border-collapse min-w-[700px]">
                <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_#e2e8f0]">
                  <tr>
                    {([
                      { label: 'Physician',  field: 'name',          align: 'left',   tooltip: null },
                      { label: 'Specialty',  field: 'specialty',     align: 'left',   tooltip: null },
                      { label: 'Segment',    field: 'segment',       align: 'left',   tooltip: null },
                      { label: 'State',      field: 'state',         align: 'left',   tooltip: null },
                      { label: 'Score',      field: 'overallScore',  align: 'center', tooltip: 'Median score across your 3 most recent sessions with the physician' },
                      { label: 'Readiness',  field: 'fieldReadiness',align: 'left',   tooltip: 'Most frequent readiness rating across your 3 most recent sessions with the physician' },
                    ] as const).map(({ label, field, align, tooltip }) => {
                      const active = sortConfig?.field === field;
                      return (
                        <th
                          key={field}
                          onClick={() => handleColumnSort(field)}
                          onMouseEnter={tooltip ? e => {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setTableTooltip({ text: tooltip, x: rect.left + rect.width / 2, y: rect.top });
                          } : undefined}
                          onMouseLeave={tooltip ? () => setTableTooltip(null) : undefined}
                          className="group/th px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none transition-colors"
                          style={{ textAlign: align as any }}
                        >
                          <span
                            className={`inline-flex items-center gap-1 group-hover/th:text-slate-600 ${align === 'center' ? 'justify-center w-full' : ''}`}
                            style={{ color: active ? '#3b82f6' : '#94a3b8' }}
                          >
                            {label}
                            {active
                              ? sortConfig!.dir === 'asc'
                                ? <ArrowUp className="w-3 h-3" />
                                : <ArrowDown className="w-3 h-3" />
                              : <ArrowUpDown className="w-3 h-3 opacity-0 group-hover/th:opacity-40 transition-opacity" />}
                          </span>
                        </th>
                      );
                    })}
                    <th className="sticky right-0 bg-white px-4 py-2.5 w-24 shadow-[-1px_0_0_0_#e2e8f0]" />
                  </tr>
                </thead>
                <tbody>
                  {filteredPhysicians.map((p) => {
                    const hasScore = p.OVERALL_SCORE != null;
                    const hasEval  = hasScore || !!p.FIELD_READINESS;

                    // Readiness badge colour
                    const readinessBadge = (val: string): React.CSSProperties => {
                      if (val === 'Field Ready')   return { background: '#d1fae5', color: '#065f46' };
                      if (val === 'Not Ready')     return { background: '#fee2e2', color: '#991b1b' };
                      if (val === 'Approaching')   return { background: '#fef3c7', color: '#92400e' };
                      return { background: '#f1f5f9', color: '#475569' };
                    };

                    return (
                      <tr key={p.PHYSICIAN_ID} className="group border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        {/* Name */}
                        <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                          Dr. {p.FIRST_NAME} {p.LAST_NAME}
                        </td>

                        {/* Specialty */}
                        <td className="px-4 py-3 text-slate-600 text-sm">
                          {p.SPECIALTY ?? <span className="text-slate-300">—</span>}
                        </td>

                        {/* Segment */}
                        <td className="px-4 py-3 text-slate-600 text-sm">
                          {p.SEGMENT_NAME ?? <span className="text-slate-300">—</span>}
                        </td>

                        {/* State */}
                        <td className="px-4 py-3 text-slate-600 text-sm">
                          {p.STATE ?? <span className="text-slate-300">—</span>}
                        </td>

                        {/* Overall Score */}
                        <td className="px-4 py-3 text-slate-700 font-semibold text-sm text-center">
                          {hasScore
                            ? p.OVERALL_SCORE
                            : <span className="text-slate-300 font-normal text-xs">—</span>}
                        </td>

                        {/* Field Readiness */}
                        <td className="px-4 py-3">
                          {p.FIELD_READINESS ? (
                            <span
                              className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
                              style={readinessBadge(p.FIELD_READINESS)}
                            >
                              {p.FIELD_READINESS}
                            </span>
                          ) : <span className="text-slate-300 text-xs">—</span>}
                        </td>

                        {/* Actions */}
                        <td className="sticky right-0 bg-white group-hover:bg-slate-50 px-4 py-3 shadow-[-1px_0_0_0_#e2e8f0] transition-colors">
                          <div className="flex items-center gap-2">
                            {/* Practice your pitch */}
                            <button
                              title="Practice your pitch"
                              onClick={() => handlePhysicianSelect(p)}
                              className="w-10 h-10 rounded-full flex items-center justify-center border border-slate-200 bg-white text-slate-500 hover:text-white hover:border-transparent transition-all"
                              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, #FF6B00, #00C8FF)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = ''; }}
                            >
                              <MessageSquare className="w-4 h-4" />
                            </button>

                            {/* View evaluation report */}
                            <button
                              title="View evaluation report"
                              onClick={() => { if (hasEval) { setEvalPhysicianId(p.PHYSICIAN_ID); setEvalOpen(true); } }}
                              disabled={!hasEval}
                              className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all ${
                                hasEval
                                  ? 'border-slate-200 bg-white text-slate-500 hover:text-white hover:border-transparent cursor-pointer'
                                  : 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
                              }`}
                              onMouseEnter={e => { if (hasEval) (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, #FF6B00, #00C8FF)'; }}
                              onMouseLeave={e => { if (hasEval) (e.currentTarget as HTMLButtonElement).style.background = ''; }}
                            >
                              <BarChart2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <EvaluationPanel open={evalOpen} onClose={() => setEvalOpen(false)} content="" username={username} physicianId={evalPhysicianId} />

          {/* Fixed-position column header tooltip — renders outside overflow container */}
          {tableTooltip && (
            <div
              className="pointer-events-none fixed z-[9999]"
              style={{ left: tableTooltip.x, top: tableTooltip.y - 8, transform: 'translate(-50%, -100%)' }}
            >
              <div className="bg-amber-50 border border-amber-200 text-slate-900 text-xs font-medium leading-snug rounded-lg px-3 py-2 whitespace-nowrap shadow-md">
                {tableTooltip.text}
              </div>
              <div className="mx-auto w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-amber-200" />
            </div>
          )}
        </div>
      );
    }

    // Default splash
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-8">
        <div className="space-y-2">
          <p className="text-2xl font-semibold text-slate-900">Ready to practice?</p>
          <p className="text-slate-500 text-sm max-w-sm">
            Select a physician and take on a realistic sales call simulation.
          </p>
        </div>
        <Button
          onClick={handleStartSession}
          className="w-64 py-6 text-base rounded-full"
          style={{
            background: 'linear-gradient(90deg, #FF6B00, #00C8FF)',
            border: 'none',
            color: 'white',
          }}
        >
          Start Training Session
        </Button>
        <Button
          variant="outline"
          onClick={() => setEvalOpen(true)}
          className="w-64 py-6 text-base rounded-full"
        >
          View Last Evaluation Report
        </Button>
        <EvaluationPanel
          open={evalOpen}
          onClose={() => setEvalOpen(false)}
          content=""
          username={username}
          physicianId={evalPhysicianId}
        />
      </div>
    );
  }

  // ── Active session ────────────────────────────────────────────────────────
  return (
    <div className="relative flex flex-col h-full min-h-0">

      {/* ── Physician context ribbon ──────────────────────────────────────── */}
      {selectedPhysician && (
        <div className="shrink-0 px-4 py-2.5 border-b border-slate-100 bg-white">
          <p className="font-semibold text-slate-900 text-sm leading-tight">
            {selectedPhysician.name}
          </p>
          {(selectedPhysician.specialty || selectedPhysician.segment) && (
            <p className="text-xs text-slate-500 mt-0.5">
              {[selectedPhysician.specialty, selectedPhysician.segment].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-1 space-y-4 pb-28">
        {messages.length === 0 && loading && (
          <div className="flex items-end gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-black shrink-0" />
            <div className="bg-slate-100 px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-2">
              <Spinner className="w-3.5 h-3.5" />
              <span className="text-sm text-slate-500">
                {statusMessage || 'Starting session...'}
              </span>
            </div>
          </div>
        )}

        {visibleMessages.map((message) => (
          <div
            key={message.id}
            className={`flex items-end gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
          >
            {message.role === 'assistant' && (
              <div className="w-2.5 h-2.5 rounded-full bg-black shrink-0 mb-2" />
            )}
            <div
              className={`max-w-sm lg:max-w-xl px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${message.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-slate-100 text-slate-900 rounded-bl-sm'
                }`}
            >
              {message.content}
              {message.isEvaluation && (
                <button
                  onClick={() => { setEvalPhysicianId(physicianIdRef.current); setEvalOpen(true); }}
                  className="mt-2 flex items-center gap-1.5 text-blue-600 hover:text-blue-700 font-medium text-xs"
                >
                  View Evaluation Report →
                </button>
              )}
            </div>
            {message.role === 'user' && (
              <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0 mb-2" />
            )}
          </div>
        ))}

        {loading && messages.length > 0 && (
          <div className="flex items-end gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-black shrink-0" />
            <div className="bg-slate-100 px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-2">
              <Spinner className="w-3.5 h-3.5" />
              <span className="text-sm text-slate-500">
                {statusMessage || 'Thinking...'}
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Bottom bar ─────────────────────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 bg-white pt-2 pb-1">
        <div className="mb-1 px-1">
          <div className="flex items-center justify-between mb-1">
            {timeRemaining !== null && sessionDuration !== null ? (
              isLastThird ? (
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded"
                  style={{ background: '#b04848', color: 'white' }}
                >
                  Time left: {timeRemaining}s
                </span>
              ) : (
                <p className="text-xs font-medium text-slate-400">
                  Time left: {timeRemaining}s
                </p>
              )
            ) : null}

            <div className="flex items-center gap-1">
              {!ttsAvailable && (
                <span
                  className="text-xs text-amber-600 font-medium mr-1"
                  title="ElevenLabs returned an error. Check your API key and account credits at elevenlabs.io."
                >
                  🔇 Error
                </span>
              )}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => {
                  const next = !voiceEnabledRef.current;
                  voiceEnabledRef.current = next;
                  setVoiceEnabled(next);
                  if (!next) stopCurrentAudio();
                }}
                className="h-7 w-7 rounded-full"
                title={voiceEnabled ? 'Disable voice' : 'Enable voice'}
              >
                {voiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5 text-slate-400" />}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setAvatarEnabled((v) => !v)}
                className="h-7 w-7 rounded-full"
                title={avatarEnabled ? 'Disable video avatar' : 'Enable video avatar (coming soon)'}
                disabled
              >
                {avatarEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5 text-slate-300" />}
              </Button>
            </div>
          </div>

          {timeRemaining !== null && sessionDuration !== null && (
            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-1">
              <div
                style={{
                  width: `${(timeRemaining / sessionDuration) * 100}%`,
                  height: '100%',
                  background: timerRatio !== null && timerRatio > 2/3 ? '#4e9e6b' : timerRatio !== null && timerRatio > 1/3 ? '#c07c3a' : '#b04848',
                  transition: 'width 1s linear, background 1s ease',
                }}
              />
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 pt-3">
          <form onSubmit={handleSubmit} className="flex gap-2 items-center">
            <AudioInput
              onTranscript={(text) =>
                setInputValue((prev) => prev + (prev ? ' ' : '') + text)
              }
              onAutoSubmit={handleAutoSubmit}
              userTyping={userTyping}
              disabled={loading || sessionEnded}
            />
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder={sessionEnded ? 'Session ended' : 'Type your response...'}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setUserTyping(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e as unknown as React.FormEvent);
                }
              }}
              onFocus={() => setUserTyping(true)}
              onBlur={() => setUserTyping(false)}
              disabled={loading || sessionEnded}
              className="flex-1 resize-none overflow-hidden rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 leading-5 min-h-[38px] max-h-40"
            />
            <Button
              type="submit"
              disabled={loading || !inputValue.trim() || sessionEnded}
              size="icon"
              className="rounded-full shrink-0"
            >
              <Send className="w-4 h-4" />
            </Button>
            {sessionEnded ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleNewSession}
                title="New session"
                className="rounded-full shrink-0"
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => sendMessage('done', messagesRef.current)}
                disabled={loading || sessionEnded}
                className="rounded-full shrink-0"
                title="End session"
              >
                <Square className="w-4 h-4" />
              </Button>
            )}
          </form>
        </div>
      </div>

      <EvaluationPanel
        open={evalOpen}
        onClose={() => setEvalOpen(false)}
        content=""
        username={username}
        physicianId={evalPhysicianId}
      />
    </div>
  );
}
