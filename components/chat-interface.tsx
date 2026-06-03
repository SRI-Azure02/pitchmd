'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePhysicianList } from '@/lib/hooks/use-physician-list';
import { Paginator } from '@/components/ui/paginator';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import AudioInput from './audio-input';
import EvaluationPanel from './evaluation-panel';
import PerformancePanel from './performance-panel';
import CallJournal from './call-journal';
import LoopBack from './loop-back';
import EngagementPlaybook from './engagement-playbook';
import { Send, RotateCcw, Square, Volume2, VolumeX, Video, VideoOff, MessageSquare, Search, ChevronDown, X, Check, BarChart2, ArrowUp, ArrowDown, ArrowUpDown, Hash, Mic, BookOpen, NotebookPen } from 'lucide-react';
import { parseEmotion, speakText, stopCurrentAudio } from '@/lib/elevenlabs';
import { buildCorrector, type Corrector } from '@/lib/product-name-corrector';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isEvaluation?: boolean;
  /** Internal seed messages (e.g. "begin roleplay") — never shown in chat UI */
  internal?: boolean;
}


function randomSessionDuration(): number {
  return 120; // 2 minutes — matches the physician's stated "up to two minutes"
}

// ── Physician list helpers ─────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';
type SortConfig = { field: string; dir: SortDir } | null;
type FilterMap = {
  overallScore: string[];
  fieldReadiness: string[];
  segment: string[];
  specialty: string[];
  mindset: string[];
};
const EMPTY_FILTERS: FilterMap = { overallScore: [], fieldReadiness: [], segment: [], specialty: [], mindset: [] };

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
    case 'mindset':       return '';
    default:              return '';
  }
}

// ── HCP Mindset constants ──────────────────────────────────────────────────

export const PRESET_MINDSETS = [
  'Data Hawk',
  'Skeptical Traditionalist',
  'Friendly Derailer',
  'Bureaucratic Defensive',
  'Cost-Conscious Pragmatist',
] as const;
export type PresetMindset = typeof PRESET_MINDSETS[number];

export interface MindsetDimension {
  id: string;
  category: string;
  name: string;
  leftLabel: string;
  rightLabel: string;
  leftDesc: string;
  rightDesc: string;
}
export interface CustomMindset { name: string; dimensions: Record<string, 'left' | 'right'>; }

export const MINDSET_DIMENSIONS: MindsetDimension[] = [
  { id: 'evidence',  category: 'Clinical Disposition',                name: 'Evidence Orientation',       leftLabel: 'Data-Driven',              rightLabel: 'Experiential',              leftDesc: 'Demands specific clinical trials, p-values, endpoints, and head-to-head data. Punishes marketing buzzwords.',            rightDesc: 'Relies on personal clinical success, peer opinions, and high-level guideline recommendations.' },
  { id: 'adoption',  category: 'Clinical Disposition',                name: 'Adoption Profile',            leftLabel: 'Innovator / Early Adopter', rightLabel: 'Late Majority / Laggard',    leftDesc: 'Eager to try new mechanisms of action; willing to tolerate early operational friction for superior efficacy.',           rightDesc: 'Deeply entrenched in current protocols; heavily relies on old, proven generics or established blockbusters.' },
  { id: 'risk',      category: 'Clinical Disposition',                name: 'Risk Tolerance',              leftLabel: 'Conservative (Low)',        rightLabel: 'Aggressive (High)',          leftDesc: 'Fixates on safety, adverse events, black-box warnings, and drug-to-drug interactions.',                                  rightDesc: 'Prioritizes absolute efficacy, speed of onset, or disease clearance; accepts standard class-effect risks.' },
  { id: 'skeptic',   category: 'Interaction & Communication',         name: 'Skepticism',                  leftLabel: 'High (Combative)',          rightLabel: 'Low (Passive)',              leftDesc: 'Actively interrupts, challenges data validity, brings up competitor advantages, and pushes back on claims.',             rightDesc: 'Polite, nods along, but hard to pin down for a concrete behavioral commitment or script change.' },
  { id: 'verbose',   category: 'Interaction & Communication',         name: 'Verbosity',                   leftLabel: 'Succinct (Low)',            rightLabel: 'Expressive (High)',          leftDesc: 'Gives 1-to-5 word answers. Forces the rep to ask tight, targeted questions or face awkward silence.',                   rightDesc: 'Tells long stories about specific patients, easily derails the timeline, requires the rep to aggressively control the room.' },
  { id: 'formulary', category: 'Institutional & Systemic Constraints',name: 'Formulary Status Awareness',  leftLabel: 'Restricted',                rightLabel: 'Flexible',                  leftDesc: 'Bound tightly by hospital or regional insurance tiering; refuses scripts that require heavy Prior Authorization paperwork.',rightDesc: 'Willing to navigate PA processes, call medical directors, or utilize co-pay cards if the clinical benefit justifies it.' },
  { id: 'patients',  category: 'Institutional & Systemic Constraints',name: 'Patient Demographic Split',   leftLabel: 'Fixed Income / Medicare',   rightLabel: 'Commercial / Premium',       leftDesc: 'Highly sensitive to out-of-pocket patient costs, tier-3 copays, and coverage gaps.',                                     rightDesc: 'Has patients with robust private insurance or employer-backed plans where specialty drug access is smoother.' },
];

// ── Multi-select filter dropdown (hover-to-open) ───────────────────────────

interface FilterDropdownProps {
  label: string;
  options: string[];
  activeFilters: string[];
  onFilter: (vals: string[]) => void;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

function PhysicianFilterDropdown({ label, options, activeFilters, onFilter, isOpen, onOpen, onClose }: FilterDropdownProps) {
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isActive = activeFilters.length > 0;

  const handleEnter = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    onOpen();
  };
  const handleLeave = () => {
    closeTimerRef.current = setTimeout(() => onClose(), 180);
  };

  const toggle = (opt: string) => {
    if (activeFilters.includes(opt)) onFilter(activeFilters.filter(v => v !== opt));
    else onFilter([...activeFilters, opt]);
  };

  // Pill label: "Segment" | "Segment (2)" | "Segment: Cardiology"
  const pillLabel = isActive
    ? activeFilters.length === 1 ? `${label}: ${activeFilters[0]}` : `${label} (${activeFilters.length})`
    : label;

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button
        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${
          isActive
            ? 'border-blue-400 bg-blue-50 text-blue-700'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        {pillLabel}
        {isActive && (
          <button
            onClick={(e) => { e.stopPropagation(); onFilter([]); }}
            className="ml-0.5 rounded-full hover:bg-blue-200 p-0.5 transition-colors"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        )}
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg min-w-[200px] py-1 overflow-hidden">
          {options.length === 0 && (
            <p className="px-4 py-2 text-sm text-slate-400">No options</p>
          )}
          {options.map((opt) => {
            const checked = activeFilters.includes(opt);
            return (
              <button
                key={opt}
                onClick={() => toggle(opt)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 hover:bg-slate-50 transition-colors ${checked ? 'text-blue-700 font-medium' : 'text-slate-600'}`}
              >
                <span className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${checked ? 'bg-blue-500 border-blue-500' : 'border-slate-300'}`}>
                  {checked && <Check className="w-2.5 h-2.5 text-white" />}
                </span>
                <span className="whitespace-nowrap">{opt}</span>
              </button>
            );
          })}
          {isActive && (
            <div className="border-t border-slate-100 mt-1 pt-1">
              <button
                onClick={() => onFilter([])}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              >
                Clear selection
              </button>
            </div>
          )}
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
  const [performanceMode, setPerformanceMode] = useState(false);
  const [callJournalMode, setCallJournalMode] = useState(false);
  const [loopBackMode, setLoopBackMode]             = useState(false);
  const [engagementPlaybookMode, setEngagementPlaybookMode] = useState(false);
  const [userTyping, setUserTyping] = useState(false);
  const [sessionDuration, setSessionDuration] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [ttsAvailable, setTtsAvailable] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(false); // muted by default; toggle to enable
  const [evalReady, setEvalReady] = useState(false); // true once REPEVAL finishes — drives persistent toast
  const [evalGenerating, setEvalGenerating] = useState(false); // true from session-end until eval is ready
  const [evalRefreshTrigger, setEvalRefreshTrigger] = useState(0); // incremented to force EvaluationPanel re-fetch
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcriptCountdownActive, setTranscriptCountdownActive] = useState(false);
  const [avatarEnabled, setAvatarEnabled] = useState(true);
  const voiceEnabledRef = useRef(false); // matches voiceEnabled initial state

  // ── Physician selection state ─────────────────────────────────────────────
  const [physicianSelectionMode, setPhysicianSelectionMode] = useState(false);
  const [selectedPhysician, setSelectedPhysician] = useState<{ name: string; specialty: string | null; segment: string | null } | null>(null);

  // ── Physician list hook (lazy — loads only when physician picker is opened) ─
  const physicianHook = usePhysicianList({ lazy: true });

  // ── Physician list filter / sort state ────────────────────────────────────
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'overallScore', dir: 'asc' });
  const [filterValues, setFilterValues] = useState<FilterMap>(EMPTY_FILTERS);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [tableTooltip, setTableTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [showPhysicianId, setShowPhysicianId] = useState(false);

  // ── HCP Mindset state ─────────────────────────────────────────────────────
  // physicianMindsets: session-scoped assignment per physician
  const [physicianMindsets, setPhysicianMindsets] = useState<Record<string, string>>({});
  // savedMindsets: named custom mindsets saved this session
  const [savedMindsets, setSavedMindsets] = useState<Record<string, CustomMindset>>({});
  // mindsetPopup: hovering over a mindset cell
  const [mindsetPopup, setMindsetPopup] = useState<{ physicianId: string; rect: DOMRect } | null>(null);
  const mindsetPopupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // customBuilder: open custom mindset builder modal
  const [customBuilder, setCustomBuilder] = useState<{
    physicianId: string;
    dims: Record<string, 'left' | 'right'>;
    name: string;
  } | null>(null);
  const [hoveredSplashBtn, setHoveredSplashBtn] = useState<string | null>(null);

  // ── Physician-list button hover state ─────────────────────────────────────
  // Key format: "<physicianId>-practice" | "<physicianId>-eval"
  // Stored in state (not inline DOM style) so React resets it on re-render and
  // it can't get stuck when the user clicks through to a session while hovering.
  const [hoveredBtnKey, setHoveredBtnKey] = useState<string | null>(null);

  // ── Tavus avatar state ─────────────────────────────────────────────────────
  const [tavusConvId, setTavusConvId] = useState<string | null>(null);
  const [avatarConnecting, setAvatarConnecting] = useState(false);
  // True while the avatar is speaking — used to mute AudioInput so the Web
  // Speech API doesn't hear the avatar's own audio output and auto-submit it.
  const [avatarSpeaking, setAvatarSpeaking] = useState(false);

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

  // ── Tavus / Daily refs ─────────────────────────────────────────────────────
  const dailyCallRef = useRef<any>(null);
  const avatarVideoRef = useRef<HTMLVideoElement>(null);
  const avatarAudioRef = useRef<HTMLAudioElement | null>(null);
  const avatarSpeakingRef = useRef(false);
  const avatarEnabledRef = useRef(false);
  const tavusConvIdRef = useRef<string | null>(null);
  const utteranceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fallback timer for clearing avatarSpeaking if replica.stopped_speaking never fires
  const avatarSpeakFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // STT product-name corrector — built once from brand list fetched on mount
  const correctorRef = useRef<Corrector>((t) => t);
  const loadingRef = useRef(false);

  // ── Sync state → refs ─────────────────────────────────────────────────────
  useEffect(() => { inputRef.current = inputValue; }, [inputValue]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { sessionEndedRef.current = sessionEnded; }, [sessionEnded]);
  useEffect(() => { voiceEnabledRef.current = voiceEnabled; }, [voiceEnabled]);
  useEffect(() => { avatarEnabledRef.current = avatarEnabled; }, [avatarEnabled]);
  useEffect(() => { tavusConvIdRef.current = tavusConvId; }, [tavusConvId]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  // Fetch brand names once on mount and build the STT product-name corrector.
  // The corrector is applied to every transcript (Web Speech API + Tavus STT)
  // to fix common recognition errors on pharmaceutical brand names.
  useEffect(() => {
    fetch('/api/physicians/brands')
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then(({ brands }: { brands: string[] }) => {
        if (brands?.length) {
          correctorRef.current = buildCorrector(brands);
          console.log(`[corrector] loaded ${brands.length} brand(s):`, brands.join(', '));
        }
      })
      .catch((err) => console.warn('[corrector] failed to load brands:', err));
  }, []);

  // Cleanup Daily call on unmount
  useEffect(() => {
    return () => {
      if (dailyCallRef.current) {
        dailyCallRef.current.leave().catch(() => {});
        dailyCallRef.current.destroy().catch(() => {});
      }
      if (avatarAudioRef.current) {
        avatarAudioRef.current.pause();
        avatarAudioRef.current.srcObject = null;
      }
      if (utteranceDebounceRef.current) clearTimeout(utteranceDebounceRef.current);
    };
  }, []);

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
      transcriptCountdownActive ||
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
  }, [roleplaying, sessionEnded, loading, transcriptCountdownActive]);

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
        setEvalGenerating(false);
        setEvalRefreshTrigger((n) => n + 1); // trigger EvaluationPanel to re-fetch with fresh data
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

      // Open evaluation panel immediately with skeleton loading
      const pid = physicianIdRef.current;
      if (pid) {
        setEvalPhysicianId(pid);
        setEvalGenerating(true);
        setEvalOpen(true);
      }

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

                // Speak the physician response — via Tavus avatar or ElevenLabs TTS.
                if (roleplayingRef.current) {
                  if (avatarEnabledRef.current && dailyCallRef.current && tavusConvIdRef.current) {
                    // Avatar mode: echo text to Tavus replica
                    speakViaTavus(emotionStripped);
                  } else if (voiceEnabledRef.current) {
                    // Audio-only mode: ElevenLabs if available, otherwise browser TTS.
                    // Mute AudioInput for the duration so the Web Speech API doesn't
                    // pick up TTS audio from the speakers and auto-submit it as user speech.
                    console.log('[tts] speaking | voice:', currentVoiceRef.current ?? 'browser', '| emotion:', emotion);
                    setAvatarSpeaking(true);
                    speakText(emotionStripped, currentVoiceRef.current, emotion)
                      .then(() => {
                        setAvatarSpeaking(false);
                        setInputValue(''); // discard any phantom text captured while physician spoke
                      })
                      .catch((err) => {
                        setAvatarSpeaking(false);
                        setInputValue('');
                        if (err?.message === 'interrupted' || err?.message === 'canceled') return;
                        console.error('[tts] failed:', err);
                        setTtsAvailable(false);
                      });
                  }
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
  const handleStartSession = () => {
    if (hasStarted.current || physicianSelectionMode) return;
    setPhysicianSelectionMode(true);
    physicianHook.load();
  };

  const handlePhysicianSelect = async (physician: any) => {
    setHoveredBtnKey(null); // clear hover state — mouseLeave never fires on click-through
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

    // If avatar is enabled, try to connect Tavus first.
    // On failure (e.g. quota exhausted, network error) the avatar is disabled
    // automatically inside initTavusAvatar and we continue in text-only mode.
    if (avatarEnabledRef.current) {
      await initTavusAvatar(physician);
    }

    // Kick off roleplay with a silent internal seed message.
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
    cleanupTavus();

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
    setEvalGenerating(false);
    setEvalRefreshTrigger(0);
    setShowTranscript(false);
  };

  // ── Tavus avatar helpers ──────────────────────────────────────────────────

  const cleanupTavus = async () => {
    if (utteranceDebounceRef.current) clearTimeout(utteranceDebounceRef.current);
    if (dailyCallRef.current) {
      try { await dailyCallRef.current.leave(); } catch {}
      try { await dailyCallRef.current.destroy(); } catch {}
      dailyCallRef.current = null;
    }
    if (avatarAudioRef.current) {
      avatarAudioRef.current.pause();
      avatarAudioRef.current.srcObject = null;
      avatarAudioRef.current = null;
    }
    if (avatarVideoRef.current) {
      avatarVideoRef.current.srcObject = null;
    }
    avatarSpeakingRef.current = false;
    setAvatarSpeaking(false);
    if (avatarSpeakFallbackRef.current) {
      clearTimeout(avatarSpeakFallbackRef.current);
      avatarSpeakFallbackRef.current = null;
    }
    setTavusConvId(null);
    tavusConvIdRef.current = null;
    setAvatarConnecting(false);
  };

  // Clears the avatar-speaking lock, opens the mic, and discards any phantom
  // Web Speech API text captured while the avatar was talking.
  const clearAvatarSpeakingLock = () => {
    if (avatarSpeakFallbackRef.current) {
      clearTimeout(avatarSpeakFallbackRef.current);
      avatarSpeakFallbackRef.current = null;
    }
    avatarSpeakingRef.current = false;
    setAvatarSpeaking(false); // re-enable AudioInput for user's turn
    setInputValue('');        // discard any phantom text captured while avatar spoke
    if (sessionEndedRef.current) cleanupTavus();
  };

  const speakViaTavus = (text: string) => {
    const daily = dailyCallRef.current;
    const convId = tavusConvIdRef.current;
    if (!daily || !convId) return;
    avatarSpeakingRef.current = true;
    setAvatarSpeaking(true); // mute AudioInput while avatar speaks
    daily.sendAppMessage(
      {
        message_type: 'conversation',
        event_type: 'conversation.echo',
        conversation_id: convId,
        properties: {
          modality: 'text',
          text,
          audio: '',
          sample_rate: 16000,
          inference_id: `inf_${Date.now()}`,
          done: true,
        },
      },
      '*',
    );
    // Primary unlock: conversation.replica.stopped_speaking event (see app-message handler).
    // Fallback: word-count estimate + generous startup-latency buffer, in case the
    // Tavus event never arrives (e.g. network drop, API version change).
    // 500 ms/word ≈ 120 WPM; +3 000 ms covers TTS synthesis + network startup lag.
    const wordCount = text.split(/\s+/).length;
    avatarSpeakFallbackRef.current = setTimeout(
      clearAvatarSpeakingLock,
      Math.max(4000, wordCount * 500 + 3000),
    );
  };

  const initTavusAvatar = async (physician: any): Promise<boolean> => {
    setAvatarConnecting(true);
    try {
      const res = await fetch('/api/tavus/conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          physicianName: `${physician.FIRST_NAME} ${physician.LAST_NAME}`,
          gender: physician.GENDER,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = (errBody as any)?.error ?? `HTTP ${res.status}`;
        const details = (errBody as any)?.details;
        console.error('[tavus] API error:', msg, details ?? '');
        throw new Error(msg);
      }
      const { conversationId, conversationUrl } = await res.json();

      // Dynamic import — browser-only library
      const DailyIframe = (await import('@daily-co/daily-js')).default;
      const daily = DailyIframe.createCallObject({
        audioSource: false,      // AudioInput handles mic; Daily only delivers avatar video/audio
        videoSource: false,
        subscribeToTracksAutomatically: true,
      });
      dailyCallRef.current = daily;

      // Promise that resolves once the remote video track starts rendering.
      // Falls back after 10 s so the session can still proceed on slow connections.
      let resolveVideoReady!: () => void;
      const videoReadyPromise = new Promise<void>(res => { resolveVideoReady = res; });
      let videoReadyTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        console.warn('[tavus] track-started timeout — proceeding without confirmed video');
        resolveVideoReady();
      }, 10_000);

      // Render avatar video + audio tracks
      daily.on('track-started', (event: any) => {
        const { track, participant } = event;
        if (participant?.local) return;
        if (track.kind === 'video' && avatarVideoRef.current) {
          const stream = (avatarVideoRef.current.srcObject as MediaStream | null) ?? new MediaStream();
          stream.addTrack(track);
          avatarVideoRef.current.srcObject = stream;
          avatarVideoRef.current.play().catch(() => {});
          // Avatar is now visible — unblock the session start
          if (videoReadyTimeout !== null) { clearTimeout(videoReadyTimeout); videoReadyTimeout = null; }
          resolveVideoReady();
        }
        if (track.kind === 'audio') {
          if (avatarAudioRef.current) {
            avatarAudioRef.current.pause();
            avatarAudioRef.current.srcObject = null;
          }
          const el = new Audio();
          el.autoplay = true;
          el.srcObject = new MediaStream([track]);
          el.play().catch(() => {});
          avatarAudioRef.current = el;
        }
      });

      // Receive events from Tavus replica
      daily.on('app-message', (event: any) => {
        const msg = event?.data;

        // ── Replica finished speaking → open mic immediately ──────────────
        // This is the authoritative signal from Tavus that TTS playback has
        // ended. Cancels the word-count fallback timer in speakViaTavus so
        // the mic opens at the exact right moment, regardless of startup lag.
        if (
          msg?.event_type === 'conversation.replica.stopped_speaking' ||
          msg?.event_type === 'replica.stopped_speaking'
        ) {
          console.log('[tavus] replica.stopped_speaking — unlocking mic');
          clearAvatarSpeakingLock();
        }

        // ── User speech transcription from Tavus STT ──────────────────────
        if (msg?.event_type === 'conversation.utterance') {
          const raw = (msg.properties?.speech as string | undefined)?.trim();
          if (raw) {
            const speech = correctorRef.current(raw);
            if (speech !== raw) console.log(`[corrector] Tavus: "${raw}" → "${speech}"`);
            if (utteranceDebounceRef.current) clearTimeout(utteranceDebounceRef.current);
            utteranceDebounceRef.current = setTimeout(() => {
              if (!avatarSpeakingRef.current && !sessionEndedRef.current && !loadingRef.current) {
                sendMessageRef.current(speech, messagesRef.current);
              }
            }, 300);
          }
        }
      });

      await daily.join({ url: conversationUrl });

      setTavusConvId(conversationId);
      tavusConvIdRef.current = conversationId;

      // Wait until the remote video track is actually rendering (or 10 s timeout).
      // This keeps "Connecting avatar…" visible and blocks sendMessage('__begin_roleplay__')
      // from firing until the avatar is on screen — so the timer and first greeting
      // are never lost to loading lag.
      await videoReadyPromise;

      setAvatarConnecting(false);
      return true;
    } catch (err) {
      console.error('[tavus] init failed:', err);
      setAvatarConnecting(false);
      setAvatarEnabled(false);
      avatarEnabledRef.current = false;
      dailyCallRef.current = null;
      // Avatar unavailable — fall back to audio-only mode automatically.
      setVoiceEnabled(true);
      voiceEnabledRef.current = true;
      return false;
    }
  };

  // ── Back to physician list (no eval triggered) ────────────────────────────
  const handleBackToPhysicianList = () => {
    stopCurrentAudio();
    cleanupTavus();
    setHoveredBtnKey(null); // reset any stuck hover style on action buttons

    // Prevent timer and any in-flight message from triggering eval
    autoEndedRef.current = true;
    sessionEndedRef.current = true;

    // Reset refs
    hasStarted.current = false;
    roleplayingRef.current = false;
    currentVoiceRef.current = null;
    physicianIdRef.current = null;
    selectedPhysicianDataRef.current = null;
    evalStartedAtRef.current = null;
    targetDurationRef.current = randomSessionDuration();

    // Reset state (no eval, no evalGenerating)
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
    setEvalGenerating(false);
    setEvalRefreshTrigger(0);
    setShowTranscript(false);
    setSelectedPhysician(null);
    setEvalPhysicianId(null);

    // Clear the guard refs after state is queued
    sessionEndedRef.current = false;

    // Return to physician list (keep the physicians array loaded)
    setPhysicianSelectionMode(true);
  };

  // ── Column header sort ────────────────────────────────────────────────────
  const SERVER_SORT_FIELDS = new Set(['name', 'specialty', 'segment', 'state', 'overallScore', 'fieldReadiness', 'lastContact']);
  const handleColumnSort = (field: string) => {
    setSortConfig(prev => {
      const newDir: SortDir = prev?.field === field && prev.dir === 'asc' ? 'desc' : 'asc';
      if (SERVER_SORT_FIELDS.has(field)) {
        physicianHook.setSort(field, newDir);
      }
      return { field, dir: newDir };
    });
  };

  // ── Derived options for dropdowns ─────────────────────────────────────────
  // Segment / specialty options come from the server (all physicians, not just current page)
  const uniqueSegments    = physicianHook.filterOptions.segments;
  const uniqueSpecialties = physicianHook.filterOptions.specialties;
  const uniqueReadiness   = useMemo(() => {
    const vals = [...new Set(physicianHook.physicians.map(p => p.FIELD_READINESS).filter(Boolean))].sort() as string[];
    if (physicianHook.physicians.some(p => !p.FIELD_READINESS)) vals.unshift('Not Evaluated');
    return vals;
  }, [physicianHook.physicians]);
  const scoreBucketOptions = useMemo(() => {
    const buckets = new Set(physicianHook.physicians.map(p => scoreBucket(p.OVERALL_SCORE)));
    const order = ['Not Evaluated', '< 6', '6–7.9', '8–8.9', '9+'];
    return order.filter(b => buckets.has(b));
  }, [physicianHook.physicians]);

  // ── Client-side multi-select filter ──────────────────────────────────────
  const filteredPhysicians = useMemo(() => {
    let result = [...physicianHook.physicians];

    if (filterValues.segment.length > 0)
      result = result.filter(p => filterValues.segment.includes(p.SEGMENT_NAME ?? 'Unknown'));

    if (filterValues.specialty.length > 0)
      result = result.filter(p => filterValues.specialty.includes(p.SPECIALTY ?? 'Unknown'));

    if (filterValues.fieldReadiness.length > 0)
      result = result.filter(p => {
        const v = p.FIELD_READINESS;
        return filterValues.fieldReadiness.includes(v ?? 'Not Evaluated');
      });

    if (filterValues.overallScore.length > 0)
      result = result.filter(p => filterValues.overallScore.includes(scoreBucket(p.OVERALL_SCORE)));

    if (filterValues.mindset.length > 0)
      result = result.filter(p => {
        const m = physicianMindsets[p.PHYSICIAN_ID] ?? 'Not Assigned';
        return filterValues.mindset.includes(m);
      });

    // physicianId is not server-sortable — sort client-side when selected
    if (sortConfig?.field === 'physicianId') {
      result.sort((a, b) => {
        const va = physicianSortValue(a, 'physicianId');
        const vb = physicianSortValue(b, 'physicianId');
        if (va === vb) return 0;
        const cmp = va < vb ? -1 : 1;
        return sortConfig.dir === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [physicianHook.physicians, filterValues, sortConfig, physicianMindsets]);

  const anyFilterActive = physicianHook.search.trim() || sortConfig ||
    Object.values(filterValues).some((arr) => arr.length > 0);

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

  // ── Full-screen section views ────────────────────────────────────────────
  if (performanceMode) {
    return <PerformancePanel onBack={() => setPerformanceMode(false)} />;
  }

  if (loopBackMode) {
    return <LoopBack username={username ?? 'Rep'} onBack={() => setLoopBackMode(false)} />;
  }

  if (engagementPlaybookMode) {
    return <EngagementPlaybook username={username ?? 'Rep'} onBack={() => setEngagementPlaybookMode(false)} />;
  }

  if (callJournalMode) {
    return <CallJournal username={username ?? 'Rep'} onBack={() => setCallJournalMode(false)} />;
  }

  // ── Pre-session splash ────────────────────────────────────────────────────
  if (!sessionStarted) {
    // Physician selection grid
    if (physicianSelectionMode) {
      return (
        <div className="flex flex-col h-full min-h-0">
          {/* ── Header ──────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-slate-100 shrink-0">
            <div>
              <p className="text-lg font-semibold text-slate-900">Select a Physician</p>
              <p className="text-sm text-slate-400">Choose who you'd like to practice with today</p>
            </div>
            <button onClick={() => setPhysicianSelectionMode(false)} className="text-sm text-slate-400 hover:text-slate-700 px-3 py-1 rounded-full hover:bg-slate-100 transition-colors">
              Back
            </button>
          </div>

          {/* ── Filter ribbon ───────────────────────────────────────────── */}
          <div className="shrink-0 px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
            <div className="flex flex-wrap items-center gap-2">
              {/* Search */}
              <div className="relative flex-1 min-w-[180px] max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={physicianHook.search}
                  onChange={e => physicianHook.setSearch(e.target.value)}
                  placeholder="Search physicians…"
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                />
                {physicianHook.search && (
                  <button onClick={() => physicianHook.setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Physician ID column toggle */}
              <button
                onClick={() => setShowPhysicianId(v => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border text-sm font-medium transition-colors ${
                  showPhysicianId
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-600'
                }`}
              >
                <Hash className="w-3 h-3" />
                {showPhysicianId ? 'Hide ID' : 'Show ID'}
              </button>

              {/* Segment */}
              <PhysicianFilterDropdown label="Segment" options={uniqueSegments}
                activeFilters={filterValues.segment}
                onFilter={vals => setFilterValues(prev => ({ ...prev, segment: vals }))}
                isOpen={openDropdown === 'segment'}
                onOpen={() => setOpenDropdown('segment')}
                onClose={() => setOpenDropdown(v => v === 'segment' ? null : v)}
              />
              {/* Specialty */}
              <PhysicianFilterDropdown label="Specialty" options={uniqueSpecialties}
                activeFilters={filterValues.specialty}
                onFilter={vals => setFilterValues(prev => ({ ...prev, specialty: vals }))}
                isOpen={openDropdown === 'specialty'}
                onOpen={() => setOpenDropdown('specialty')}
                onClose={() => setOpenDropdown(v => v === 'specialty' ? null : v)}
              />
              {/* Overall Score */}
              <PhysicianFilterDropdown label="Score" options={scoreBucketOptions}
                activeFilters={filterValues.overallScore}
                onFilter={vals => setFilterValues(prev => ({ ...prev, overallScore: vals }))}
                isOpen={openDropdown === 'overallScore'}
                onOpen={() => setOpenDropdown('overallScore')}
                onClose={() => setOpenDropdown(v => v === 'overallScore' ? null : v)}
              />
              {/* Field Readiness */}
              <PhysicianFilterDropdown label="Readiness" options={uniqueReadiness}
                activeFilters={filterValues.fieldReadiness}
                onFilter={vals => setFilterValues(prev => ({ ...prev, fieldReadiness: vals }))}
                isOpen={openDropdown === 'fieldReadiness'}
                onOpen={() => setOpenDropdown('fieldReadiness')}
                onClose={() => setOpenDropdown(v => v === 'fieldReadiness' ? null : v)}
              />
              {/* HCP Mindset */}
              <PhysicianFilterDropdown
                label="HCP Mindset"
                options={[...PRESET_MINDSETS, 'Custom', 'Not Assigned']}
                activeFilters={filterValues.mindset}
                onFilter={vals => setFilterValues(prev => ({ ...prev, mindset: vals }))}
                isOpen={openDropdown === 'mindset'}
                onOpen={() => setOpenDropdown('mindset')}
                onClose={() => setOpenDropdown(v => v === 'mindset' ? null : v)}
              />

              {/* Clear all */}
              {anyFilterActive && (
                <button
                  onClick={() => { physicianHook.setSearch(''); setSortConfig(null); setFilterValues(EMPTY_FILTERS); }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-sm text-slate-500 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>

            {/* Result count */}
            <p className="text-xs text-slate-400 mt-1.5">
              {filteredPhysicians.length} of {physicianHook.totalCount} physician{physicianHook.totalCount !== 1 ? 's' : ''}
              {anyFilterActive ? ' match your filters' : ''}
            </p>
          </div>

          {/* ── Physician table ──────────────────────────────────────────── */}
          <div className="flex-1 overflow-auto">
            {physicianHook.loading ? (
              <div className="flex items-center justify-center h-40 gap-2 text-slate-400">
                <Spinner className="w-4 h-4" />
                <span className="text-sm">Loading physicians...</span>
              </div>
            ) : filteredPhysicians.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-slate-400">
                <p className="text-sm font-medium">No physicians match your filters.</p>
                <button onClick={() => { physicianHook.setSearch(''); physicianHook.setFilterSegment(null); physicianHook.setFilterSpecialty(null); setFilterValues({ overallScore: null, fieldReadiness: null }); setSortConfig(null); }} className="text-xs text-blue-500 hover:underline">Clear filters</button>
              </div>
            ) : (
              <table className="w-full text-base border-collapse min-w-[700px]">
                <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_#e2e8f0]">
                  <tr>
                    {([
                      { label: 'Physician ID', field: 'physicianId',   align: 'left',   tooltip: null },
                      { label: 'Physician',    field: 'name',          align: 'left',   tooltip: null },
                      { label: 'Specialty',    field: 'specialty',     align: 'left',   tooltip: null },
                      { label: 'Segment',     field: 'segment',       align: 'left',   tooltip: null },
                      { label: 'State',       field: 'state',         align: 'left',   tooltip: null },
                      { label: 'Score',       field: 'overallScore',  align: 'center', tooltip: 'Median score across your 3 most recent sessions with the physician' },
                      { label: 'Readiness',   field: 'fieldReadiness',align: 'left',   tooltip: 'Most frequent readiness rating across your 3 most recent sessions with the physician' },
                      { label: 'HCP Mindset', field: 'mindset',       align: 'left',   tooltip: 'Hover to assign a mindset persona for this practice session' },
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
                          className="group/th px-4 py-2.5 text-sm font-semibold uppercase tracking-wide cursor-pointer select-none transition-colors"
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
                      <tr key={p.PHYSICIAN_ID} className="group border-b border-slate-100 hover:bg-slate-100/70 transition-colors">
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

                        {/* Overall Score */}
                        <td className="px-4 py-3 text-slate-700 font-semibold text-center">
                          {hasScore
                            ? Number(p.OVERALL_SCORE).toFixed(1)
                            : <span className="text-slate-300 font-normal text-sm">—</span>}
                        </td>

                        {/* Field Readiness */}
                        <td className="px-4 py-3">
                          {p.FIELD_READINESS ? (
                            <span
                              className="text-sm font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
                              style={readinessBadge(p.FIELD_READINESS)}
                            >
                              {p.FIELD_READINESS}
                            </span>
                          ) : <span className="text-slate-300 text-sm">—</span>}
                        </td>

                        {/* HCP Mindset */}
                        <td className="px-4 py-3 relative">
                          <div
                            className="relative inline-block"
                            onMouseEnter={(e) => {
                              if (mindsetPopupTimerRef.current) clearTimeout(mindsetPopupTimerRef.current);
                              setMindsetPopup({ physicianId: p.PHYSICIAN_ID, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
                            }}
                            onMouseLeave={() => {
                              mindsetPopupTimerRef.current = setTimeout(() => setMindsetPopup(null), 200);
                            }}
                          >
                            {physicianMindsets[p.PHYSICIAN_ID] ? (
                              <span className="text-sm font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 whitespace-nowrap cursor-default">
                                {physicianMindsets[p.PHYSICIAN_ID]}
                              </span>
                            ) : (
                              <span className="text-slate-300 text-sm cursor-default hover:text-slate-400">Set mindset…</span>
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="sticky right-0 bg-white group-hover:bg-slate-100/70 px-4 py-2.5 shadow-[-1px_0_0_0_#e2e8f0] transition-colors">
                          <div className="flex items-center gap-2">
                            {/* Practice your pitch */}
                            <button
                              title="Practice your pitch"
                              onClick={() => handlePhysicianSelect(p)}
                              className="h-9 px-4 rounded-full flex items-center gap-2 border border-slate-200 bg-white text-slate-500 text-sm font-medium hover:text-white hover:border-transparent transition-all whitespace-nowrap"
                              style={hoveredBtnKey === `${p.PHYSICIAN_ID}-practice` ? { background: 'linear-gradient(135deg, #FF6B00, #00C8FF)' } : {}}
                              onMouseEnter={() => setHoveredBtnKey(`${p.PHYSICIAN_ID}-practice`)}
                              onMouseLeave={() => setHoveredBtnKey(null)}
                            >
                              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                              Practice Pitch
                            </button>

                            {/* View evaluation report */}
                            <button
                              title="View evaluation report"
                              onClick={() => { if (hasEval) { setEvalPhysicianId(p.PHYSICIAN_ID); setEvalOpen(true); } }}
                              disabled={!hasEval}
                              className={`h-9 px-4 rounded-full flex items-center gap-2 border text-sm font-medium transition-all whitespace-nowrap ${
                                hasEval
                                  ? 'border-slate-200 bg-white text-slate-500 hover:text-white hover:border-transparent cursor-pointer'
                                  : 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
                              }`}
                              style={hasEval && hoveredBtnKey === `${p.PHYSICIAN_ID}-eval` ? { background: 'linear-gradient(135deg, #FF6B00, #00C8FF)' } : {}}
                              onMouseEnter={() => { if (hasEval) setHoveredBtnKey(`${p.PHYSICIAN_ID}-eval`); }}
                              onMouseLeave={() => { if (hasEval) setHoveredBtnKey(null); }}
                            >
                              <BarChart2 className="w-3.5 h-3.5 shrink-0" />
                              Evaluation
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

          <Paginator
            page={physicianHook.page}
            pageSize={physicianHook.pageSize}
            total={physicianHook.totalCount}
            onPageChange={physicianHook.setPage}
          />

          <EvaluationPanel open={evalOpen} onClose={() => setEvalOpen(false)} content="" username={username} physicianId={evalPhysicianId} />

          {/* Fixed-position column header tooltip */}
          {tableTooltip && (
            <div className="pointer-events-none fixed z-[9999]" style={{ left: tableTooltip.x, top: tableTooltip.y - 8, transform: 'translate(-50%, -100%)' }}>
              <div className="bg-amber-50 border border-amber-200 text-slate-900 text-xs font-medium leading-snug rounded-lg px-3 py-2 whitespace-nowrap shadow-md">{tableTooltip.text}</div>
              <div className="mx-auto w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-amber-200" />
            </div>
          )}

          {/* ── Mindset hover popup ─────────────────────────────────────── */}
          {mindsetPopup && (
            <div
              className="fixed z-[9000]"
              style={{ left: mindsetPopup.rect.left, top: mindsetPopup.rect.bottom + 4 }}
              onMouseEnter={() => { if (mindsetPopupTimerRef.current) clearTimeout(mindsetPopupTimerRef.current); }}
              onMouseLeave={() => { mindsetPopupTimerRef.current = setTimeout(() => setMindsetPopup(null), 200); }}
            >
              <div className="bg-white border border-slate-200 rounded-xl shadow-xl py-1.5 min-w-[220px] overflow-hidden">
                <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Assign Mindset</p>
                {[...PRESET_MINDSETS].map((m) => {
                  const active = physicianMindsets[mindsetPopup.physicianId] === m;
                  return (
                    <button key={m} onClick={() => {
                      setPhysicianMindsets(prev => ({ ...prev, [mindsetPopup.physicianId]: m }));
                      setMindsetPopup(null);
                    }} className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${active ? 'bg-violet-50 text-violet-700 font-medium' : 'text-slate-700 hover:bg-slate-50'}`}>
                      {active && <Check className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
                      {!active && <span className="w-3.5 h-3.5 shrink-0" />}
                      {m}
                    </button>
                  );
                })}
                {/* Custom saved mindsets */}
                {Object.keys(savedMindsets).map((name) => {
                  const active = physicianMindsets[mindsetPopup.physicianId] === name;
                  return (
                    <button key={name} onClick={() => {
                      setPhysicianMindsets(prev => ({ ...prev, [mindsetPopup.physicianId]: name }));
                      setMindsetPopup(null);
                    }} className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${active ? 'bg-violet-50 text-violet-700 font-medium' : 'text-slate-700 hover:bg-slate-50'}`}>
                      {active && <Check className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
                      {!active && <span className="w-3.5 h-3.5 shrink-0" />}
                      <span className="italic">{name}</span>
                      <span className="ml-auto text-[10px] text-slate-400 bg-slate-100 px-1.5 rounded-full">Custom</span>
                    </button>
                  );
                })}
                <div className="border-t border-slate-100 mt-1">
                  <button onClick={() => {
                    const existing = savedMindsets[physicianMindsets[mindsetPopup.physicianId] ?? ''];
                    setCustomBuilder({
                      physicianId: mindsetPopup.physicianId,
                      dims: existing?.dimensions ?? Object.fromEntries(MINDSET_DIMENSIONS.map(d => [d.id, 'left'])) as Record<string, 'left'|'right'>,
                      name: '',
                    });
                    setMindsetPopup(null);
                  }} className="w-full text-left px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 flex items-center gap-2 transition-colors">
                    <span className="w-3.5 h-3.5 shrink-0" />
                    Custom mindset…
                  </button>
                  {physicianMindsets[mindsetPopup.physicianId] && (
                    <button onClick={() => {
                      setPhysicianMindsets(prev => { const n = { ...prev }; delete n[mindsetPopup.physicianId]; return n; });
                      setMindsetPopup(null);
                    }} className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-50 flex items-center gap-2 transition-colors">
                      <span className="w-3.5 h-3.5 shrink-0" />
                      Remove mindset
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Custom mindset builder modal ────────────────────────────── */}
          {customBuilder && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                  <div>
                    <p className="text-base font-semibold text-slate-900">Custom HCP Mindset</p>
                    <p className="text-xs text-slate-400 mt-0.5">Toggle each dimension, name your mindset, then save.</p>
                  </div>
                  <button onClick={() => setCustomBuilder(null)} className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X className="w-4 h-4" /></button>
                </div>

                {/* Dimensions */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
                  {(['Clinical Disposition', 'Interaction & Communication', 'Institutional & Systemic Constraints'] as const).map((cat) => {
                    const dims = MINDSET_DIMENSIONS.filter(d => d.category === cat);
                    return (
                      <div key={cat}>
                        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">{cat}</p>
                        <div className="space-y-3">
                          {dims.map((dim) => {
                            const val = customBuilder.dims[dim.id] ?? 'left';
                            return (
                              <div key={dim.id} className="bg-slate-50 rounded-xl p-4">
                                <p className="text-sm font-semibold text-slate-800 mb-3">{dim.name}</p>
                                <div className="flex items-stretch gap-2">
                                  {/* Left option */}
                                  <button
                                    onClick={() => setCustomBuilder(b => b ? { ...b, dims: { ...b.dims, [dim.id]: 'left' } } : b)}
                                    className={`flex-1 text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${val === 'left' ? 'border-violet-400 bg-violet-50 text-violet-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                                  >
                                    <p className="font-medium text-xs mb-1">{dim.leftLabel}</p>
                                    <p className="text-xs leading-snug opacity-70">{dim.leftDesc}</p>
                                  </button>
                                  {/* Toggle indicator */}
                                  <div className="flex flex-col items-center justify-center gap-1 px-1">
                                    <div className={`w-2 h-2 rounded-full transition-colors ${val === 'left' ? 'bg-violet-400' : 'bg-slate-200'}`} />
                                    <div className="w-0.5 h-3 bg-slate-200" />
                                    <div className={`w-2 h-2 rounded-full transition-colors ${val === 'right' ? 'bg-violet-400' : 'bg-slate-200'}`} />
                                  </div>
                                  {/* Right option */}
                                  <button
                                    onClick={() => setCustomBuilder(b => b ? { ...b, dims: { ...b.dims, [dim.id]: 'right' } } : b)}
                                    className={`flex-1 text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${val === 'right' ? 'border-violet-400 bg-violet-50 text-violet-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                                  >
                                    <p className="font-medium text-xs mb-1">{dim.rightLabel}</p>
                                    <p className="text-xs leading-snug opacity-70">{dim.rightDesc}</p>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer — name + save */}
                <div className="border-t border-slate-100 px-6 py-4 flex items-center gap-3">
                  <input
                    type="text"
                    value={customBuilder.name}
                    onChange={e => setCustomBuilder(b => b ? { ...b, name: e.target.value } : b)}
                    placeholder="Name this mindset…"
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400"
                  />
                  <button
                    disabled={!customBuilder.name.trim()}
                    onClick={() => {
                      const n = customBuilder.name.trim();
                      if (!n) return;
                      const saved: CustomMindset = { name: n, dimensions: customBuilder.dims };
                      setSavedMindsets(prev => ({ ...prev, [n]: saved }));
                      setPhysicianMindsets(prev => ({ ...prev, [customBuilder.physicianId]: n }));
                      setCustomBuilder(null);
                    }}
                    className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Save &amp; Apply
                  </button>
                  <button onClick={() => setCustomBuilder(null)} className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100 transition-colors">Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Default splash — three horizontal rows
    // Row 1 (top):    Practice Your Pitch  |  Review Performance
    // Row 2 (middle): Engagement Playbook (full width)
    // Row 3 (bottom): Call Journal  |  Loop Back

    const splashTile = (
      label: string,
      description: string,
      icon: React.ReactNode,
      badge: string,
      action?: () => void,
      extraClass = '',
    ) => {
      const active = !!action;
      return (
        <button
          key={label}
          onClick={action}
          disabled={!active}
          style={hoveredSplashBtn === label ? { background: 'linear-gradient(135deg, #C47B42, #C49868, #45A8C8)' } : {}}
          onMouseEnter={() => { if (active) setHoveredSplashBtn(label); }}
          onMouseLeave={() => setHoveredSplashBtn(null)}
          className={`relative flex items-center gap-5 rounded-2xl border px-6 py-12 text-left transition-all duration-200 ${
            active
              ? 'border-slate-200 bg-[#F1EFE9] shadow-sm hover:shadow-md hover:border-transparent cursor-pointer'
              : 'border-slate-100 bg-slate-50/60 cursor-not-allowed'
          } ${extraClass}`}
        >
          {/* Icon */}
          <div className={`shrink-0 transition-colors ${
            active ? (hoveredSplashBtn === label ? 'text-white' : 'text-slate-500') : 'text-slate-300'
          }`}>
            {icon}
          </div>

          {/* Text */}
          <div className="flex flex-col justify-between min-w-0 gap-3">
            <span className={`text-xs font-semibold uppercase tracking-widest transition-colors ${
              active ? (hoveredSplashBtn === label ? 'text-white/70' : 'text-slate-400') : 'text-slate-300'
            }`}>
              {badge}
            </span>
            <p className={`font-semibold text-base leading-snug transition-colors ${
              active ? (hoveredSplashBtn === label ? 'text-white' : 'text-slate-800') : 'text-slate-400'
            }`}>
              {label}
            </p>
            <p className={`text-sm leading-snug transition-colors ${
              active ? (hoveredSplashBtn === label ? 'text-white/80' : 'text-slate-500') : 'text-slate-300'
            }`}>
              {description}
            </p>
          </div>

          {!active && (
            <span className="absolute top-3 right-4 text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              Coming soon
            </span>
          )}
        </button>
      );
    };

    return (
      <div className="flex flex-col h-full items-center justify-center px-6 py-6">

        {/* ── Three-row layout ──────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 w-full max-w-4xl">

          {/* Row 1 — Pre-Field */}
          <div className="flex gap-4">
            {splashTile(
              'Practice Your Pitch',
              'Simulate a live sales call with a physician and get real-time coaching.',
              <Mic className="w-7 h-7" />,
              'Pre-Field',
              handleStartSession,
              'flex-1',
            )}
            {splashTile(
              'Review Performance',
              'See your scores and detailed feedback from recent sessions.',
              <BarChart2 className="w-7 h-7" />,
              'Pre-Field',
              () => setPerformanceMode(true),
              'flex-1',
            )}
          </div>

          {/* Row 2 — In-Field (full width) */}
          <div className="flex">
            {splashTile(
              'Engagement Playbook',
              'Walk in with the right message every time — shaped by physician segment, Rx trends, and your last visit notes.',
              <BookOpen className="w-7 h-7" />,
              'In-Field',
              () => setEngagementPlaybookMode(true),
              'w-full',
            )}
          </div>

          {/* Row 3 — Post-Field */}
          <div className="flex gap-4">
            {splashTile(
              'Call Journal',
              'Log notes and outcomes after each physician interaction.',
              <NotebookPen className="w-7 h-7" />,
              'Post-Field',
              () => setCallJournalMode(true),
              'flex-1',
            )}
            {splashTile(
              'Loop Back',
              'Track commitments made during your calls and follow through on every promise.',
              <RotateCcw className="w-7 h-7" />,
              'Post-Field',
              () => setLoopBackMode(true),
              'flex-1',
            )}
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

  // ── Active session ────────────────────────────────────────────────────────
  return (
    <div className="relative flex flex-col h-full min-h-0">

      {/* ── Video call area ───────────────────────────────────────────────────── */}
      <div
        className="flex-1 relative overflow-hidden"
        style={!(avatarEnabled && tavusConvId) ? {
          background: 'linear-gradient(120deg, #C47B42, #C49868, #45A8C8, #3A8FB5, #C47B42)',
          backgroundSize: '400% 400%',
          animation: 'gradientShift 10s ease infinite',
        } : { background: '#111' }}
      >
        {/* Tavus avatar video */}
        <video
          ref={avatarVideoRef}
          autoPlay
          playsInline
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${avatarEnabled && tavusConvId ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        />

        {/* Gradient placeholder (no avatar) */}
        {!avatarEnabled && (
          <div className="absolute inset-0 flex flex-col items-center justify-center select-none pointer-events-none">
            <VideoOff className="w-14 h-14 text-gray-800/20 mb-3" />
            <p className="text-gray-800/25 text-xs tracking-widest uppercase">Enable avatar to start video</p>
          </div>
        )}

        {/* Avatar connecting overlay */}
        {avatarConnecting && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-20">
            <div className="bg-white/90 backdrop-blur-sm px-5 py-3 rounded-2xl flex items-center gap-3 shadow">
              <Spinner className="w-4 h-4 text-gray-600" />
              <span className="text-sm text-gray-700">Connecting avatar…</span>
            </div>
          </div>
        )}

        {/* Back button — top-right, returns to physician list without triggering eval */}
        <div className="absolute top-3 right-3 z-10">
          <button
            onClick={handleBackToPhysicianList}
            className="flex items-center gap-1.5 bg-white/70 backdrop-blur-sm hover:bg-white/90 text-gray-700 text-sm font-medium px-3 py-1.5 rounded-full shadow transition-all"
          >
            Back
          </button>
        </div>

        {/* Physician nameplate — bottom-left overlay */}
        {selectedPhysician && (
          <div className="absolute bottom-4 left-4 z-10 bg-white/60 backdrop-blur-sm px-4 py-2 rounded-lg">
            <p className="text-black font-semibold text-lg leading-tight">
              {selectedPhysician.name}
            </p>
            {(selectedPhysician.specialty || selectedPhysician.segment) && (
              <p className="text-gray-700 text-sm mt-0.5">
                {[selectedPhysician.specialty, selectedPhysician.segment].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        )}

        {/* Loading indicator (session start) */}
        {messages.length === 0 && loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-white/80 backdrop-blur-sm px-5 py-3 rounded-2xl flex items-center gap-3 shadow">
              <Spinner className="w-4 h-4 text-gray-600" />
              <span className="text-sm text-gray-700">{statusMessage || 'Starting session...'}</span>
            </div>
          </div>
        )}

        {/* Transcript overlay — centered column, comfortable reading width */}
        {showTranscript && (
          <div className="absolute inset-0 z-10 flex justify-center overflow-hidden">
            <div
              className="w-full max-w-2xl h-full bg-white/80 backdrop-blur-sm overflow-y-auto p-4 space-y-3 shadow-xl"
              style={{
                maskImage: 'linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%)',
              }}
            >
              {visibleMessages.map((message) => (
                <div
                  key={message.id}
                  className={`flex items-end gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {message.role === 'assistant' && (
                    <div className="w-2 h-2 rounded-full bg-gray-500 shrink-0 mb-1.5" />
                  )}
                  <div
                    className={`max-w-sm lg:max-w-xl px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                      message.role === 'user'
                        ? 'bg-gray-800 text-white rounded-br-sm'
                        : 'bg-white text-slate-800 rounded-bl-sm shadow-sm'
                    }`}
                  >
                    {message.content}
                    {message.isEvaluation && (
                      <button
                        onClick={() => { setEvalPhysicianId(physicianIdRef.current); setEvalOpen(true); }}
                        className="mt-2 flex items-center gap-1.5 text-gray-600 hover:text-gray-800 font-medium text-xs"
                      >
                        View Evaluation Report →
                      </button>
                    )}
                  </div>
                  {message.role === 'user' && (
                    <div className="w-2 h-2 rounded-full bg-gray-500 shrink-0 mb-1.5" />
                  )}
                </div>
              ))}
              {/* Streaming bubble */}
              {loading && streamingContent && (
                <div className="flex items-end gap-2">
                  <div className="w-2 h-2 rounded-full bg-gray-500 shrink-0 mb-1.5" />
                  <div className="max-w-sm lg:max-w-xl px-3.5 py-2.5 rounded-2xl rounded-bl-sm bg-white text-slate-800 text-sm leading-relaxed whitespace-pre-wrap shadow-sm">
                    {streamingContent.replace(/^\[EMOTION:[^\]]+\]\s*/i, '')}
                    <span className="inline-block w-1.5 h-3.5 bg-gray-600 ml-0.5 align-middle animate-pulse" />
                  </div>
                </div>
              )}
              {loading && !streamingContent && messages.length > 0 && (
                <div className="flex items-end gap-2">
                  <div className="w-2 h-2 rounded-full bg-gray-400 shrink-0" />
                  <div className="bg-white px-3.5 py-2.5 rounded-2xl rounded-bl-sm flex items-center gap-2 shadow-sm">
                    <Spinner className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-sm text-slate-600">{statusMessage || 'Thinking...'}</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}


        {/* Eval-generating notification (shown when timer ends, until report is ready) */}
        {evalGenerating && !evalReady && (
          <div className="absolute top-4 left-0 right-0 flex justify-center px-4 z-20 pointer-events-none">
            <div className="flex items-center gap-2.5 bg-white/90 backdrop-blur-sm text-gray-800 text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg border border-gray-200">
              <Spinner className="w-3.5 h-3.5 text-gray-500 shrink-0" />
              <span>Session complete · Generating your evaluation report…</span>
            </div>
          </div>
        )}

        {/* Eval-ready toast */}
        {evalReady && (
          <div className="absolute top-4 left-0 right-0 flex justify-center px-4 z-20 pointer-events-none">
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
      </div>

      {/* ── Bottom bar ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 pt-2 pb-2" style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(16px)', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
        {/* Timer row: label | progress bar | voice+video */}
        <div className="mb-2 flex items-center gap-2">
          <div className="w-20 shrink-0">
            {timeRemaining !== null && sessionDuration !== null ? (
              isLastThird ? (
                <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: '#b04848', color: 'white' }}>
                  {timeRemaining}s
                </span>
              ) : (
                <p className="text-xs font-medium text-gray-600">{timeRemaining}s</p>
              )
            ) : null}
          </div>
          <div className="flex-1">
            {timeRemaining !== null && sessionDuration !== null && (
              <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
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
          {/* Pinned voice/video toggles */}
          <div className="flex items-center gap-1 shrink-0">
            {!ttsAvailable && (
              <span className="text-xs text-amber-500" title="TTS unavailable">🔇</span>
            )}
            <Button
              type="button" size="icon" variant="ghost"
              onClick={() => {
                const next = !voiceEnabledRef.current;
                voiceEnabledRef.current = next;
                setVoiceEnabled(next);
                if (!next) stopCurrentAudio();
              }}
              className="h-7 w-7 rounded-full text-gray-600 hover:text-gray-800 hover:bg-gray-100"
              title={voiceEnabled ? 'Disable voice' : 'Enable voice'}
            >
              {voiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </Button>
            <Button
              type="button" size="icon" variant="ghost"
              onClick={async () => {
                const next = !avatarEnabled;
                setAvatarEnabled(next);
                avatarEnabledRef.current = next;
                if (next && sessionStarted && selectedPhysicianDataRef.current && !dailyCallRef.current) {
                  // Connect Tavus mid-session
                  await initTavusAvatar(selectedPhysicianDataRef.current);
                } else if (!next) {
                  cleanupTavus();
                }
              }}
              className={`h-7 w-7 rounded-full hover:bg-gray-100 ${avatarEnabled ? 'text-blue-500' : 'text-gray-400'}`}
              title={avatarEnabled ? 'Disable video avatar' : 'Enable video avatar'}
            >
              {avatarEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>

        {/* Input row */}
        <form onSubmit={handleSubmit} className="flex gap-2 items-center">
          {/* Transcript toggle */}
          <Button
            type="button" size="icon" variant="ghost"
            onClick={() => setShowTranscript((v) => !v)}
            className={`h-8 w-8 rounded-full shrink-0 ${showTranscript ? 'bg-gray-200 text-gray-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
            title={showTranscript ? 'Hide transcript' : 'Show transcript'}
          >
            <MessageSquare className="w-4 h-4" />
          </Button>
          <AudioInput
            onTranscript={(text) => {
                const corrected = correctorRef.current(text);
                setInputValue((prev) => prev + (prev ? ' ' : '') + corrected);
              }}
            onAutoSubmit={handleAutoSubmit}
            onCountdown={(pct) => setTranscriptCountdownActive(pct !== null)}
            userTyping={userTyping}
            disabled={loading || sessionEnded || avatarSpeaking || !roleplaying}
          />
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={sessionEnded ? 'Session ended' : 'Type your response...'}
            value={inputValue}
            onChange={(e) => { setInputValue(e.target.value); setUserTyping(true); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as unknown as React.FormEvent);
              }
            }}
            onFocus={() => setUserTyping(true)}
            onBlur={() => setUserTyping(false)}
            disabled={loading || sessionEnded}
            className="flex-1 resize-none overflow-hidden rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-40 leading-5 min-h-[38px] max-h-40"
          />
          <Button
            type="submit"
            disabled={loading || !inputValue.trim() || sessionEnded}
            size="icon"
            className="rounded-full shrink-0 bg-gray-800 hover:bg-gray-700 text-white"
          >
            <Send className="w-4 h-4" />
          </Button>
          {sessionEnded ? (
            <Button
              type="button" variant="ghost" size="icon"
              onClick={handleNewSession}
              title="New session"
              className="rounded-full shrink-0 text-gray-600 hover:text-gray-800 hover:bg-gray-100"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              type="button" variant="ghost" size="icon"
              onClick={() => sendMessage('done', messagesRef.current)}
              disabled={loading || sessionEnded}
              className="rounded-full shrink-0 text-slate-400 hover:text-red-500 hover:bg-red-50"
              title="End session"
            >
              <Square className="w-4 h-4" />
            </Button>
          )}
        </form>
      </div>

      <EvaluationPanel
        open={evalOpen}
        onClose={() => setEvalOpen(false)}
        content=""
        username={username}
        physicianId={evalPhysicianId}
        generating={evalGenerating}
        refreshTrigger={evalRefreshTrigger}
      />
    </div>
  );
}
