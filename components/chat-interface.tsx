'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import AudioInput from './audio-input';
import EvaluationPanel from './evaluation-panel';
import PerformancePanel from './performance-panel';
import { Send, RotateCcw, Square, Volume2, VolumeX, Video, VideoOff, MessageSquare, Search, ChevronDown, X, Check, BarChart2, ArrowUp, ArrowDown, ArrowUpDown, Hash } from 'lucide-react';
import { parseEmotion, speakText, stopCurrentAudio } from '@/lib/elevenlabs';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isEvaluation?: boolean;
  /** Internal seed messages (e.g. "begin roleplay") — never shown in chat UI */
  internal?: boolean;
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
    case 'physicianId':   return (p.PHYSICIAN_ID ?? '').toLowerCase();
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
  options: string[];
  activeFilter: string | null;
  onFilter: (val: string | null) => void;
  isOpen: boolean;
  onToggle: () => void;
}

function PhysicianFilterDropdown({
  label, options, activeFilter, onFilter, isOpen, onToggle,
}: FilterDropdownProps) {
  const isActive = !!activeFilter;

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
        </div>
      )}
    </div>
  );
}

// ── Streaming helpers ──────────────────────────────────────────────────────

/**
 * Count complete sentences in `text`, respecting common title abbreviations
 * (Dr., Mr., etc.) so they don't produce false sentence boundaries.
 * Only counts sentences that are truly ended (followed by whitespace or EOS).
 */
function countCompleteSentences(text: string): number {
  const TITLE_ABBREV = /\b(Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|vs|etc)\s*\.$/i;
  // Split on sentence-ending punctuation followed by whitespace
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  let count = 0;
  for (let i = 0; i < parts.length - 1; i++) { // last part may be incomplete
    if (!TITLE_ABBREV.test(parts[i])) count++;
  }
  // Also count the last part if text ends with sentence-ending punctuation
  if (parts.length > 0) {
    const last = parts[parts.length - 1];
    if (/[.!?]$/.test(last) && !TITLE_ABBREV.test(last)) count++;
  }
  return count;
}

/**
 * Truncate `text` to at most `maxSentences` complete sentences.
 */
function truncateToSentences(text: string, maxSentences: number): string {
  const TITLE_ABBREV = /\b(Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|vs|etc)\s*\.$/i;
  const rawParts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const sentences: string[] = [];
  for (let i = 0; i < rawParts.length; i++) {
    const part = rawParts[i];
    if (TITLE_ABBREV.test(part) && i + 1 < rawParts.length) {
      rawParts[i + 1] = `${part} ${rawParts[i + 1]}`;
    } else {
      sentences.push(part);
    }
  }
  return sentences.slice(0, maxSentences).join(' ');
}

// ── Component ──────────────────────────────────────────────────────────────

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
  const [performanceOpen, setPerformanceOpen] = useState(false);
  const [userTyping, setUserTyping] = useState(false);
  const [sessionDuration, setSessionDuration] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [ttsAvailable, setTtsAvailable] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(false); // muted by default; toggle to enable
  const [evalReady, setEvalReady] = useState(false); // true once REPEVAL finishes — drives persistent toast
  const [avatarEnabled, setAvatarEnabled] = useState(false);
  const voiceEnabledRef = useRef(false); // matches voiceEnabled initial state

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
  const [showPhysicianId, setShowPhysicianId] = useState(false);
  const [hoveredSplashBtn, setHoveredSplashBtn] = useState<string | null>(null);

  // FIX 1+2: Incremental streaming state
  // streamingContent holds physician tokens as they arrive so the user sees
  // text appearing word-by-word instead of waiting for the full response.
  const [streamingContent, setStreamingContent] = useState<string>('');
  const streamingContentRef = useRef<string>('');   // sync ref for accumulation
  const streamingSentences = useRef<number>(0);      // sentences rendered so far
  const isStreamingRef = useRef<boolean>(false);     // true while chunk events arrive

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
  // Full physician object stored at selection time; used to build the Claude
  // system prompt for direct-API roleplay (bypasses Snowflake Cortex Agent).
  const selectedPhysicianDataRef = useRef<any>(null);
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
      .filter((m) => !m.isEvaluation && !m.internal)
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
        setEvalReady(true);
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

    const isInternalSeed = text === '__begin_roleplay__';
    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: text,
      ...(isInternalSeed ? { internal: true } : {}),
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
      // FIX 1+2: Reset streaming state for each new message
      streamingContentRef.current = '';
      streamingSentences.current = 0;
      isStreamingRef.current = false;
      setStreamingContent('');

      // Build context window.
      // For direct Claude roleplay we send the full history (Claude is fast
      // and has no Snowflake planning step).  For legacy Cortex fallback we
      // keep the trimmed window (first 2 + last 5).
      const inRoleplay = selectedPhysicianDataRef.current !== null;

      let contextMessages: Message[];
      if (inRoleplay) {
        // Send full history — Claude handles long context efficiently
        contextMessages = updatedMessages;
      } else {
        // Legacy Cortex path: trimmed window to reduce planning-step latency
        const HEAD = Math.min(2, updatedMessages.length);
        const headIds = new Set(updatedMessages.slice(0, HEAD).map((m) => m.id));
        const tail = updatedMessages.slice(-5);
        contextMessages = updatedMessages.length > 7
          ? [...updatedMessages.slice(0, HEAD), ...tail.filter((m) => !headIds.has(m.id))]
          : updatedMessages;
      }

      // Route: direct Claude API during roleplay; Snowflake Cortex as fallback
      const endpoint = inRoleplay ? '/api/roleplay/message' : '/api/cortex/query';
      const requestBody = inRoleplay
        ? {
            messages: contextMessages.map((m) => ({
              role: m.role,
              content: m.content,
              internal: m.internal ?? false,
            })),
            physician: selectedPhysicianDataRef.current,
            username,
          }
        : {
            messages: contextMessages.map((m) => ({ role: m.role, content: m.content })),
          };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
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

            } else if (event.type === 'chunk') {
              // FIX 1+2: Incremental token from the server — append to the
              // streaming bubble, capped at 2 complete sentences.
              if (streamingSentences.current >= 2) continue;
              isStreamingRef.current = true;

              const candidate = streamingContentRef.current + event.text;
              const sentenceCount = countCompleteSentences(candidate);

              if (sentenceCount >= 2) {
                // Extract emotion tag from the start of the streamed block
                const emotionMatch = candidate.match(/^\[EMOTION:[^\]]+\]\s*/i);
                const emotionPrefix = emotionMatch ? emotionMatch[0] : '';
                const body = candidate.slice(emotionPrefix.length);
                const truncated = truncateToSentences(body, 2);
                streamingContentRef.current = emotionPrefix + truncated;
                streamingSentences.current = 2;
              } else {
                streamingContentRef.current = candidate;
                streamingSentences.current = sentenceCount;
              }
              setStreamingContent(streamingContentRef.current);

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
                // Clear any partial streaming content
                streamingContentRef.current = '';
                streamingSentences.current = 0;
                isStreamingRef.current = false;
                setStreamingContent('');
                setLoading(false);
                setStatusMessage('');
                continue;
              }
              const isEval = event.isEvaluation === true;

              // Read metadata from event fields, not from stripped text
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

              // FIX 1+2: Always use the server-processed event.text as the
              // authoritative display text.  The streaming bubble (streamingContent)
              // provides visual feedback only — it is cleared here and replaced
              // by the final message.  This prevents planning-block false-positives
              // from leaking into message history even if the streaming detection
              // briefly shows wrong content in the live bubble.
              const displayText = event.text;

              // Clear streaming state — bubble replaced by final committed message
              streamingContentRef.current = '';
              streamingSentences.current = 0;
              isStreamingRef.current = false;
              setStreamingContent('');

              const { emotion, cleanText: emotionStripped } = parseEmotion(displayText);

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
                      if (err?.message === 'interrupted' || err?.message === 'canceled') return;
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

    // Lock in physician ID and voice model immediately.
    physicianIdRef.current = id;
    if (physician.VOICE_MODEL && !currentVoiceRef.current) {
      currentVoiceRef.current = physician.VOICE_MODEL;
    }

    // Store full physician object so sendMessage can build the Claude system prompt.
    selectedPhysicianDataRef.current = physician;

    setSelectedPhysician({
      name,
      specialty: physician.SPECIALTY ?? null,
      segment:   physician.SEGMENT_NAME ?? null,
    });
    setPhysicianSelectionMode(false);
    setSessionStarted(true);
    hasStarted.current = true;

    // Kick off roleplay with a silent internal seed message — this triggers
    // the physician's opening greeting via direct Claude API (no Snowflake hop).
    // The message is marked internal=true so it is never shown in the chat UI.
    sendMessage('__begin_roleplay__', []);
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
    selectedPhysicianDataRef.current = null;
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
    setEvalReady(false);
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
      !m.internal &&
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

              {/* Physician ID column toggle */}
              <button
                onClick={() => setShowPhysicianId(v => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  showPhysicianId
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-600'
                }`}
              >
                <Hash className="w-3 h-3" />
                {showPhysicianId ? 'Hide Physician ID' : 'Show Physician ID'}
              </button>

              {/* Segment dropdown */}
              <PhysicianFilterDropdown
                label="Segment"
                options={uniqueSegments}
                activeFilter={filterValues.segment}
                onFilter={val => setFilterValues(prev => ({ ...prev, segment: val }))}
                isOpen={openDropdown === 'segment'}
                onToggle={() => setOpenDropdown(v => v === 'segment' ? null : 'segment')}
              />

              {/* Specialty dropdown */}
              <PhysicianFilterDropdown
                label="Specialty"
                options={uniqueSpecialties}
                activeFilter={filterValues.specialty}
                onFilter={val => setFilterValues(prev => ({ ...prev, specialty: val }))}
                isOpen={openDropdown === 'specialty'}
                onToggle={() => setOpenDropdown(v => v === 'specialty' ? null : 'specialty')}
              />

              {/* Overall Score dropdown */}
              <PhysicianFilterDropdown
                label="Overall Score"
                options={scoreBucketOptions}
                activeFilter={filterValues.overallScore}
                onFilter={val => setFilterValues(prev => ({ ...prev, overallScore: val }))}
                isOpen={openDropdown === 'overallScore'}
                onToggle={() => setOpenDropdown(v => v === 'overallScore' ? null : 'overallScore')}
              />

              {/* Field Readiness dropdown */}
              <PhysicianFilterDropdown
                label="Field Readiness"
                options={uniqueReadiness}
                activeFilter={filterValues.fieldReadiness}
                onFilter={val => setFilterValues(prev => ({ ...prev, fieldReadiness: val }))}
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
                      { label: 'Physician ID', field: 'physicianId',   align: 'left',   tooltip: null },
                      { label: 'Physician',    field: 'name',          align: 'left',   tooltip: null },
                      { label: 'Specialty',    field: 'specialty',     align: 'left',   tooltip: null },
                      { label: 'Segment',    field: 'segment',       align: 'left',   tooltip: null },
                      { label: 'State',      field: 'state',         align: 'left',   tooltip: null },
                      { label: 'Score',      field: 'overallScore',  align: 'center', tooltip: 'Median score across your 3 most recent sessions with the physician' },
                      { label: 'Readiness',  field: 'fieldReadiness',align: 'left',   tooltip: 'Most frequent readiness rating across your 3 most recent sessions with the physician' },
                    ] as const).map(({ label, field, align, tooltip }) => {
                      if (field === 'physicianId' && !showPhysicianId) return null;
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
                        {/* Physician ID (hidden by default) */}
                        {showPhysicianId && (
                          <td className="px-4 py-3 text-slate-500 text-sm font-mono">
                            {p.PHYSICIAN_ID ?? <span className="text-slate-300">—</span>}
                          </td>
                        )}

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
    const splashBtn = (label: string, action: () => void, description: string) => (
      <div key={label} className="relative w-44">
        <p className={`absolute bottom-full mb-1.5 w-44 text-xs text-slate-500 leading-snug transition-opacity duration-150 ${hoveredSplashBtn === label ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          {description}
        </p>
        <Button
          onClick={action}
          className="w-44 py-2.5 text-sm rounded-xl border border-slate-200 text-slate-700 transition-all bg-white"
          onMouseEnter={e => {
            setHoveredSplashBtn(label);
            const el = e.currentTarget as HTMLButtonElement;
            el.style.background = 'linear-gradient(90deg, #FF6B00, #00C8FF)';
            el.style.color = 'white';
            el.style.borderColor = 'transparent';
          }}
          onMouseLeave={e => {
            setHoveredSplashBtn(null);
            const el = e.currentTarget as HTMLButtonElement;
            el.style.background = 'white';
            el.style.color = '';
            el.style.borderColor = '';
          }}
        >
          {label}
        </Button>
      </div>
    );

    return (
      <div className="flex flex-col h-full gap-3 px-4 py-8">

        {/* ── Pre-Field ─────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col justify-between rounded-2xl border border-slate-200 px-6 py-4 shadow-sm" style={{ background: '#F1EFE9' }}>
          <p className="text-sm font-bold uppercase tracking-widest text-slate-500">Pre-Field</p>
          <div className="flex flex-wrap gap-4">
            {splashBtn('Practice Your Pitch', handleStartSession, 'Simulate a live sales call with a physician and get real-time coaching.')}
            {splashBtn('Review Performance', () => setPerformanceOpen(true), 'See your scores and detailed feedback from recent sessions.')}
          </div>
        </div>

        {/* ── In-Field ──────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col justify-between rounded-2xl border border-slate-200 px-6 py-4 shadow-sm" style={{ background: '#F1EFE9' }}>
          <p className="text-sm font-bold uppercase tracking-widest text-slate-500">In-Field</p>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled
              className="w-44 py-2.5 text-sm rounded-xl border border-slate-200 bg-white text-slate-400 cursor-not-allowed"
            >
              Engagement Playbook
            </Button>
          </div>
        </div>

        {/* ── Post-Field ────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col justify-between rounded-2xl border border-slate-200 px-6 py-4 shadow-sm" style={{ background: '#F1EFE9' }}>
          <p className="text-sm font-bold uppercase tracking-widest text-slate-500">Post-Field</p>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled
              className="w-44 py-2.5 text-sm rounded-xl border border-slate-200 bg-white text-slate-400 cursor-not-allowed"
            >
              Call Journal
            </Button>
          </div>
        </div>

        <EvaluationPanel
          open={evalOpen}
          onClose={() => setEvalOpen(false)}
          content=""
          username={username}
          physicianId={evalPhysicianId}
        />
        <PerformancePanel
          open={performanceOpen}
          onClose={() => setPerformanceOpen(false)}
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

        {/* FIX 1+2: Show streaming content as it arrives token-by-token,
            replacing the generic spinner once chunks start flowing in. */}
        {loading && streamingContent && (
          <div className="flex items-end gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-black shrink-0 mb-2" />
            <div className="max-w-sm lg:max-w-xl px-4 py-3 rounded-2xl rounded-bl-sm bg-slate-100 text-slate-900 text-sm leading-relaxed whitespace-pre-wrap">
              {streamingContent.replace(/^\[EMOTION:[^\]]+\]\s*/i, '')}
              <span className="inline-block w-1.5 h-3.5 bg-slate-400 ml-0.5 align-middle animate-pulse" />
            </div>
          </div>
        )}
        {loading && !streamingContent && messages.length > 0 && (
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

      {/* ── Eval-ready toast ────────────────────────────────────────────────── */}
      {evalReady && (
        <div className="absolute bottom-16 left-0 right-0 flex justify-center px-4 z-20 pointer-events-none">
          <div className="flex items-center gap-3 bg-green-600 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg pointer-events-auto">
            <span>Your evaluation report is ready.</span>
            <button
              onClick={() => { setEvalPhysicianId(physicianIdRef.current); setEvalOpen(true); }}
              className="underline underline-offset-2 hover:no-underline font-bold"
            >
              View Report
            </button>
            <button onClick={() => setEvalReady(false)} className="ml-1 opacity-70 hover:opacity-100 text-base leading-none">×</button>
          </div>
        </div>
      )}

      {/* ── Bottom bar ─────────────────────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 bg-white pt-2 pb-1">
        {/* Single row: timer label | progress bar (flex-1) | pinned buttons */}
        <div className="mb-1 px-1 flex items-center gap-2">
          {/* Timer label — fixed width so bar doesn't jump */}
          <div className="w-24 shrink-0">
            {timeRemaining !== null && sessionDuration !== null ? (
              isLastThird ? (
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded"
                  style={{ background: '#b04848', color: 'white' }}
                >
                  Time: {timeRemaining}s
                </span>
              ) : (
                <p className="text-xs font-medium text-slate-400">
                  Time: {timeRemaining}s
                </p>
              )
            ) : null}
          </div>

          {/* Progress bar — takes all remaining space */}
          <div className="flex-1">
            {timeRemaining !== null && sessionDuration !== null ? (
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  style={{
                    width: `${(timeRemaining / sessionDuration) * 100}%`,
                    height: '100%',
                    background: timerRatio !== null && timerRatio > 2/3 ? '#4e9e6b' : timerRatio !== null && timerRatio > 1/3 ? '#c07c3a' : '#b04848',
                    transition: 'width 1s linear, background 1s ease',
                  }}
                />
              </div>
            ) : null}
          </div>

          {/* Pinned-right controls — never move */}
          <div className="flex items-center gap-1 shrink-0">
            {!ttsAvailable && (
              <span
                className="text-xs text-amber-600 font-medium"
                title="ElevenLabs returned an error. Check your API key and account credits at elevenlabs.io."
              >
                🔇
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
