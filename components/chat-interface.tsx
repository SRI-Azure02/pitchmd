'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePhysicianList } from '@/lib/hooks/use-physician-list';
import { Paginator } from '@/components/ui/paginator';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import AudioInput from './audio-input';
import EvaluationPanel from './evaluation-panel';
import CameraConsentModal from './camera-consent-modal';
import CameraSetupModal from './camera-setup-modal';
import type { FacialAnalysisResult } from '@/app/api/facial-analysis/route';
import PerformancePanel from './performance-panel';
import CallJournal from './call-journal';
import LoopBack from './loop-back';
import EngagementPlaybook from './engagement-playbook';
import { Send, RotateCcw, Square, Volume2, VolumeX, Video, VideoOff, MessageSquare, Search, ChevronDown, X, Check, BarChart2, ArrowUp, ArrowDown, ArrowUpDown, Hash, Mic, BookOpen, NotebookPen, Map, Camera, Monitor, Sparkles, Database, ShieldAlert, Languages, Target, Bell, PhoneOff, Hourglass, ShieldCheck, ToggleLeft, Trash2 } from 'lucide-react';
import { parseEmotion, speakText, stopCurrentAudio } from '@/lib/elevenlabs';
import { buildCorrector, type Corrector } from '@/lib/product-name-corrector';
import { getMindsetDescription } from '@/lib/mindset-descriptions';
import { PRESET_MINDSETS, MINDSET_DIMENSIONS, type MindsetDimension, type CustomMindset, type PresetMindset } from '@/lib/mindset-types';
import { useAvatarProvider } from '@/lib/hooks/use-avatar-provider';
import { AvatarProvider } from '@/lib/avatar/types';
import type { AnamController } from '@/lib/avatar/anam-controller';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isEvaluation?: boolean;
  /** Internal seed messages (e.g. "begin roleplay") — never shown in chat UI */
  internal?: boolean;
  /** Phase 3: rep input was blocked by compliance filter */
  isComplianceBlock?: boolean;
  /** Phase 3: rep input was flagged (warning) — physician still responds */
  isComplianceFlag?: boolean;
  /** Rule code that triggered the block/flag */
  complianceRuleCode?: string;
  /** Human-readable rule name */
  complianceRuleName?: string;
  /** Screen share notification — rendered as an info card, not a speech bubble */
  isScreenShare?: boolean;
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

// ── HCP Mindset constants (re-exported from lib/mindset-types) ───────────
// PRESET_MINDSETS, MINDSET_DIMENSIONS, MindsetDimension, CustomMindset,
// PresetMindset are imported at the top and used directly below.

// ── Roadmap items ────────────────────────────────────────────────────────
const ROADMAP_ITEMS = [
  {
    icon: <Monitor className="w-5 h-5" />,
    title: 'Screen Content Reader',
    description: 'Trigger an on-demand screen capture so PitchMD can read and reference what\'s currently on your screen.',
    status: 'Pending Testing',
  },
  {
    icon: <Camera className="w-5 h-5" />,
    title: 'Facial & Body Language Feedback',
    description: 'Use your device camera to analyse facial expressions and body language in real time, with coaching feedback on your non-verbal presentation.',
    status: 'Planned',
  },
  {
    icon: <Sparkles className="w-5 h-5" />,
    title: 'Enhanced Avatar',
    description: 'More expressive and responsive physician personas with richer emotional range, improved lip-sync, and context-aware gestures.',
    status: 'Live',
  },
  {
    icon: <Database className="w-5 h-5" />,
    title: 'Cross-Session Mindset Persistence',
    description: 'Assigned HCP mindsets persist across training sessions so the physician persona remembers your history and adapts over time.',
    status: 'Planned',
  },
  {
    icon: <Languages className="w-5 h-5" />,
    title: 'Vocabulary Enhancement',
    description: 'Whisper-based speech recognition with pharmaceutical vocabulary priming for accurate transcription of brand names like Venclexta, Brukinsa, and Imbruvica.',
    status: 'Live',
  },
  {
    icon: <Target className="w-5 h-5" />,
    title: 'Adversarial Red-Team Testing',
    description: 'Automated daily test suite that fires adversarial prompts at the compliance stack — off-label requests, jailbreaks, TLS minimization — and fails the build if any bypass.',
    status: 'Planned',
  },
  {
    icon: <Bell className="w-5 h-5" />,
    title: 'Label Update Monitoring',
    description: 'Detects when a product Prescribing Information is revised and automatically flags affected training content for MLR re-review before the next session.',
    status: 'Planned',
  },
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
  // True once the physician's opening greeting has finished speaking.
  // The session countdown only starts ticking after this point so the
  // rep's allotted time is not eaten up by the greeting itself.
  const [greetingDelivered, setGreetingDelivered] = useState(false);
  const greetingDeliveredRef = useRef(false); // sync mirror for async callbacks
  const greetingStartedRef   = useRef(false); // true once avatar first speaks
  const [ttsAvailable, setTtsAvailable] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(false); // muted by default; toggle to enable
  const [evalReady, setEvalReady] = useState(false); // true once REPEVAL finishes — drives persistent toast
  const [evalGenerating, setEvalGenerating] = useState(false); // true from session-end until eval is ready
  const [evalRefreshTrigger, setEvalRefreshTrigger] = useState(0); // incremented to force EvaluationPanel re-fetch
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcriptCountdownActive, setTranscriptCountdownActive] = useState(false);

  // ── Facial analysis state ────────────────────────────────────────────────
  const [consentModalOpen, setConsentModalOpen]   = useState(false);
  const [cameraSetupOpen, setCameraSetupOpen]     = useState(false);
  const [cameraActive, setCameraActive]           = useState(false);
  const [facialAnalysis, setFacialAnalysis]       = useState<FacialAnalysisResult | null>(null);
  const [facialAnalysisRunning, setFacialAnalysisRunning] = useState(false);
  // Ref-based camera internals — no re-render needed for stream/frames/interval
  const cameraStreamRef        = useRef<MediaStream | null>(null);
  const capturedFramesRef      = useRef<string[]>([]);
  const frameCaptureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Persistent hidden video element — avoids the async loadedmetadata race in captureFrame
  const captureVideoRef        = useRef<HTMLVideoElement | null>(null);
  // Stores the physician being selected while the consent modal is open
  const pendingPhysicianRef    = useRef<any>(null);

  // ── Screen reader state ───────────────────────────────────────────────────
  const [screenCapturing, setScreenCapturing] = useState(false);
  // Screen context accumulates across multiple captures for the whole session.
  // screenAcknowledgedRef tracks whether the physician has acknowledged the
  // current accumulated content — resets each time new content is added so
  // the physician always reacts to the latest capture.
  const [pendingScreenContext, setPendingScreenContext] = useState<string | null>(null);
  const screenAcknowledgedRef = useRef(false);
  const screenCaptureCountRef = useRef(0);
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

  // ── Roadmap state ─────────────────────────────────────────────────────────
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const roadmapRef = useRef<HTMLDivElement>(null);

  // ── Training completion state ─────────────────────────────────────────────
  const [completionLogged, setCompletionLogged] = useState(false);

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

  // ── Avatar provider (Tavus | Anam) ──────────────────────────────────────────
  // Persisted to localStorage; affects NEW sessions only.
  const { avatarProvider, setAvatarProvider } = useAvatarProvider();
  const avatarProviderRef = useRef<AvatarProvider>(avatarProvider);

  // ── Tavus avatar state ─────────────────────────────────────────────────────
  const [tavusConvId, setTavusConvId] = useState<string | null>(null);
  // True once EITHER provider's avatar video is rendering — drives the video
  // frame opacity and the echo-dispatch gate (provider-agnostic).
  const [avatarStreamActive, setAvatarStreamActive] = useState(false);
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
  // ── Anam refs ───────────────────────────────────────────────────────────────
  const anamControllerRef = useRef<AnamController | null>(null);
  // True while any provider's avatar stream is live (sync mirror of state).
  const avatarStreamActiveRef = useRef(false);
  const utteranceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fallback timer for clearing avatarSpeaking if replica.stopped_speaking never fires
  const avatarSpeakFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Physician speech buffered while the avatar is still connecting (parallel-init
  // mode: the LLM may respond before daily.join / Anam stream finishes).
  // Drained by initTavusAvatar / initAnamAvatar when the stream activates.
  const pendingSpeechRef = useRef<string | null>(null);
  // STT product-name corrector — built once from brand list fetched on mount
  const correctorRef = useRef<Corrector>((t) => t);
  // Mindset description — set at session start from the assigned mindset for this physician
  const selectedMindsetDescRef = useRef<string | null>(null);
  // Compliance session ID — generated at session start, included in every roleplay message call
  const sessionIdRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  // ── Sync state → refs ─────────────────────────────────────────────────────
  useEffect(() => { inputRef.current = inputValue; }, [inputValue]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { sessionEndedRef.current = sessionEnded; }, [sessionEnded]);
  useEffect(() => { voiceEnabledRef.current = voiceEnabled; }, [voiceEnabled]);
  useEffect(() => { avatarEnabledRef.current = avatarEnabled; }, [avatarEnabled]);
  useEffect(() => { tavusConvIdRef.current = tavusConvId; }, [tavusConvId]);
  useEffect(() => { avatarProviderRef.current = avatarProvider; }, [avatarProvider]);
  useEffect(() => { avatarStreamActiveRef.current = avatarStreamActive; }, [avatarStreamActive]);
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

  // Cleanup avatar streams (Tavus Daily call + Anam client) on unmount
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
      if (anamControllerRef.current) {
        anamControllerRef.current.cleanup().catch(() => {});
        anamControllerRef.current = null;
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
  // Does NOT start until greetingDelivered=true so the physician's opening
  // statement doesn't eat into the rep's allotted time.
  useEffect(() => {
    if (
      !roleplaying ||
      sessionEnded ||
      loading ||
      transcriptCountdownActive ||
      timeRemaining === null ||
      timeRemaining <= 0 ||
      !greetingDelivered
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
  }, [roleplaying, sessionEnded, loading, transcriptCountdownActive, greetingDelivered]);

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

  // ── Greeting detection ────────────────────────────────────────────────────
  // Watch avatarSpeaking: once it transitions true → false for the first time
  // during a session, the physician's opening greeting is done and the session
  // countdown starts.  greetingStartedRef prevents a false-positive when the
  // effect first runs with avatarSpeaking=false before speaking has begun.
  useEffect(() => {
    if (!roleplaying || greetingDeliveredRef.current) return;
    if (avatarSpeaking) {
      greetingStartedRef.current = true;        // greeting is now playing
    } else if (greetingStartedRef.current) {
      // Avatar was speaking and just stopped — opening greeting delivered.
      greetingDeliveredRef.current = true;
      setGreetingDelivered(true);
      console.log('[timer] greeting delivered — starting session countdown');
    }
  }, [avatarSpeaking, roleplaying]);

  // Text-only mode fallback: no avatar or TTS, so greeting never "plays".
  // Mark it delivered immediately so the timer starts when roleplaying does.
  useEffect(() => {
    if (!roleplaying || greetingDeliveredRef.current) return;
    if (!avatarEnabled && !ttsAvailable) {
      greetingDeliveredRef.current = true;
      setGreetingDelivered(true);
    }
  }, [roleplaying, avatarEnabled, ttsAvailable]);

  // Safety net: if the avatar never speaks within 25 s (connection failure,
  // silent error, etc.) start the timer anyway so the rep isn't frozen.
  useEffect(() => {
    if (!roleplaying || greetingDeliveredRef.current) return;
    const t = setTimeout(() => {
      if (!greetingDeliveredRef.current) {
        console.warn('[timer] greeting detection timed out (25 s) — starting timer');
        greetingDeliveredRef.current = true;
        setGreetingDelivered(true);
      }
    }, 25_000);
    return () => clearTimeout(t);
  }, [roleplaying]);

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

      // Stop camera and run facial analysis in parallel with REPEVAL
      stopCamera();
      runFacialAnalysis();
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
        // Send full history — Claude handles long context efficiently.
        // Strip screen share annotation cards — they're UI-only, not speech turns.
        contextMessages = updatedMessages.filter((m) => !m.isScreenShare);
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
      // Screen context persists for the whole session. Track whether this is
      // the first send so the physician gets an "acknowledge" prompt once,
      // then a quieter "for reference" prompt on all subsequent turns.
      const screenContextForThisCall = pendingScreenContext;
      const isNewScreenContent = screenContextForThisCall !== null && !screenAcknowledgedRef.current;
      if (isNewScreenContent) screenAcknowledgedRef.current = true;

      const requestBody = inRoleplay
        ? {
            messages: contextMessages.map((m) => ({
              role: m.role,
              content: m.content,
              internal: m.internal ?? false,
            })),
            physician: selectedPhysicianDataRef.current,
            username,
            mindsetDescription: selectedMindsetDescRef.current ?? undefined,
            sessionId: sessionIdRef.current ?? undefined,
            screenContent: screenContextForThisCall ?? undefined,
            screenContentIsNew: isNewScreenContent,
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

                // Speak the physician response — via the active avatar provider
                // (Tavus or Anam, both in echo mode) or fall back to ElevenLabs TTS.
                if (roleplayingRef.current) {
                  // Apply brand-name corrector so TTS reads "Venclexta" rather
                  // than spelling out "V-E-N-C-L-E-X-T-A" (DB stores all-caps).
                  const speechText = correctorRef.current(emotionStripped);
                  if (avatarEnabledRef.current && avatarStreamActiveRef.current) {
                    // Avatar mode: echo text to the active provider
                    speakViaAvatar(speechText);
                  } else if (avatarEnabledRef.current) {
                    // Avatar is enabled but still connecting (parallel-init) —
                    // buffer until ready. initTavusAvatar / initAnamAvatar will
                    // drain this the moment the stream activates.
                    console.log('[avatar] buffering physician speech — stream not yet active');
                    pendingSpeechRef.current = speechText;
                  } else if (voiceEnabledRef.current) {
                    // Audio-only mode: ElevenLabs if available, otherwise browser TTS.
                    // Mute AudioInput for the duration so the Web Speech API doesn't
                    // pick up TTS audio from the speakers and auto-submit it as user speech.
                    console.log('[tts] speaking | voice:', currentVoiceRef.current ?? 'browser', '| emotion:', emotion);
                    setAvatarSpeaking(true);
                    // Re-enable mic 1 s before speech ends so it's ready the moment
                    // the physician finishes. onNearlyDone fires early; the .then()
                    // is a safety net in case onNearlyDone never fired (very short clips).
                    const enableMicEarly = () => {
                      setAvatarSpeaking(false);
                      setInputValue(''); // discard phantom text captured during speech
                    };
                    speakText(speechText, currentVoiceRef.current, emotion, enableMicEarly)
                      .then(() => {
                        // Safety net — enableMicEarly may already have fired
                        setAvatarSpeaking(false);
                        setInputValue('');
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

            } else if (event.type === 'rep_flagged') {
              // Flagged (warning) input — physician will still respond, but show
              // an amber training notice so the rep knows their message was non-compliant.
              setMessages((prev) => [
                ...prev,
                {
                  id: `compliance_flag_${Date.now()}`,
                  role: 'assistant' as const,
                  content: event.message ?? 'Your message may be outside approved promotional guidelines.',
                  isComplianceFlag: true,
                  complianceRuleCode: event.rule_code,
                  complianceRuleName: event.rule_name,
                },
              ]);

            } else if (event.type === 'input_blocked') {
              // Phase 3: rep input blocked by compliance filter
              // Show a compliance notice instead of a physician response
              setMessages((prev) => [
                ...prev,
                {
                  id: `compliance_block_${Date.now()}`,
                  role: 'assistant' as const,
                  content: event.message ?? 'This message was blocked by the compliance filter.',
                  isComplianceBlock: true,
                  complianceRuleCode: event.rule_code,
                },
              ]);
              setStreamingContent('');
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
      // Safety-net: if the stream closed without a 'done'/'input_blocked' event
      // (e.g. Vercel function timeout, network drop) loading would stay true
      // forever — reset it so the user isn't permanently locked out.
      if (loadingRef.current) {
        console.warn('[sendMessage] stream ended without a done event — resetting loading');
        setLoading(false);
        setStatusMessage('');
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

  const handlePhysicianSelect = (physician: any) => {
    setHoveredBtnKey(null);
    // Stash physician and show consent modal — session starts after user responds.
    pendingPhysicianRef.current = physician;
    setFacialAnalysis(null);
    capturedFramesRef.current = [];
    setConsentModalOpen(true);
  };

  const startSessionWithPhysician = async (physician: any, withCamera: boolean, preVerifiedStream?: MediaStream) => {
    const id: string = physician.PHYSICIAN_ID;
    const name = `Dr. ${physician.FIRST_NAME} ${physician.LAST_NAME}`;

    // Lock in physician ID and voice model immediately.
    physicianIdRef.current = id;
    if (physician.VOICE_MODEL && !currentVoiceRef.current) {
      currentVoiceRef.current = physician.VOICE_MODEL;
    }

    // Store full physician object so sendMessage can build the Claude system prompt.
    selectedPhysicianDataRef.current = physician;

    // Capture assigned mindset (if any) for this session — locked in at start.
    const assignedMindset = physicianMindsets[id] ?? null;
    selectedMindsetDescRef.current = getMindsetDescription(assignedMindset, savedMindsets);
    sessionIdRef.current = crypto.randomUUID();
    if (assignedMindset) console.log(`[mindset] Physician ${id} — mindset: ${assignedMindset}`);

    setSelectedPhysician({
      name,
      specialty: physician.SPECIALTY ?? null,
      segment:   physician.SEGMENT_NAME ?? null,
    });
    setPhysicianSelectionMode(false);
    setSessionStarted(true);
    hasStarted.current = true;

    // Start camera if consent was given. If a pre-verified stream was passed from
    // CameraSetupModal, reuse it directly instead of calling getUserMedia again.
    if (withCamera) startCamera(preVerifiedStream);

    // Fire avatar init and the LLM opening message concurrently.
    const avatarInit = avatarEnabledRef.current
      ? initAvatar(physician)
      : Promise.resolve(true);
    sendMessage('__begin_roleplay__', []);
    await avatarInit;
  };

  const handleConsentAccept = () => {
    setConsentModalOpen(false);
    setCameraSetupOpen(true);
  };

  const handleConsentDecline = async () => {
    setConsentModalOpen(false);
    const physician = pendingPhysicianRef.current;
    if (physician) await startSessionWithPhysician(physician, false);
  };

  const handleSetupConfirm = async (stream: MediaStream) => {
    setCameraSetupOpen(false);
    const physician = pendingPhysicianRef.current;
    if (physician) await startSessionWithPhysician(physician, true, stream);
  };

  const handleSetupSkip = async () => {
    setCameraSetupOpen(false);
    const physician = pendingPhysicianRef.current;
    if (physician) await startSessionWithPhysician(physician, false);
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

  // ── Facial analysis ──────────────────────────────────────────────────────

  const captureFrame = () => {
    const video = captureVideoRef.current;
    if (!video || video.readyState < 2) return; // HAVE_CURRENT_DATA not yet ready
    const track = cameraStreamRef.current?.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') return;
    const w = video.videoWidth  || 640;
    const h = video.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width  = Math.min(w, 640);
    canvas.height = Math.round(h * (canvas.width / w));
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const b64 = canvas.toDataURL('image/jpeg', 0.75).split(',')[1];
    if (b64) capturedFramesRef.current.push(b64);
  };

  const startCamera = async (existingStream?: MediaStream) => {
    try {
      const stream = existingStream ?? await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      cameraStreamRef.current = stream;
      capturedFramesRef.current = [];

      // Attach stream to a persistent hidden video element so captureFrame can
      // draw synchronously without the loadedmetadata async race each time.
      const vid = document.createElement('video');
      vid.srcObject = stream;
      vid.muted = true;
      vid.playsInline = true;
      vid.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:-9999px';
      document.body.appendChild(vid);
      captureVideoRef.current = vid;
      await vid.play().catch(() => {});

      setCameraActive(true);
      // Capture first frame immediately, then every 20 seconds
      captureFrame();
      frameCaptureIntervalRef.current = setInterval(captureFrame, 20_000);
    } catch (err: any) {
      if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') {
        console.error('[camera] getUserMedia failed:', err?.message);
      }
    }
  };

  const stopCamera = () => {
    if (frameCaptureIntervalRef.current) {
      clearInterval(frameCaptureIntervalRef.current);
      frameCaptureIntervalRef.current = null;
    }
    if (captureVideoRef.current) {
      captureVideoRef.current.srcObject = null;
      captureVideoRef.current.remove();
      captureVideoRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }
    setCameraActive(false);
  };

  const runFacialAnalysis = async () => {
    const frames = capturedFramesRef.current;
    if (frames.length === 0) return;
    setFacialAnalysisRunning(true);
    try {
      const res = await fetch('/api/facial-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames }),
      });
      if (!res.ok) throw new Error(`facial-analysis API error: ${res.status}`);
      const result: FacialAnalysisResult = await res.json();
      setFacialAnalysis(result);
    } catch (err: any) {
      console.error('[facial-analysis] failed:', err?.message);
    } finally {
      setFacialAnalysisRunning(false);
    }
  };

  // ── Screen capture ────────────────────────────────────────────────────────
  const handleScreenCapture = async () => {
    if (screenCapturing || sessionEnded || !roleplaying) return;
    setScreenCapturing(true);
    try {
      // 1. Request display media (browser native picker — works on laptop + iPad)
      const stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { frameRate: 1 },
        audio: false,
      });

      // 2. Grab one frame via canvas
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await new Promise<void>((resolve) => { video.onloadedmetadata = () => resolve(); });
      video.play();
      await new Promise<void>((resolve) => { video.oncanplay = () => resolve(); });

      const MAX_W = 1280;
      const scale = video.videoWidth > MAX_W ? MAX_W / video.videoWidth : 1;
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(video.videoWidth  * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // 3. Stop stream immediately after capture
      stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());

      // 4. Convert to base64 JPEG
      const dataUrl = canvas.toDataURL('image/jpeg', 0.80);
      const base64  = dataUrl.split(',')[1];

      // 5. Send to screen-reader API
      const res = await fetch('/api/screen-reader', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mediaType: 'image/jpeg' }),
      });
      if (!res.ok) throw new Error(`Screen reader API error: ${res.status}`);
      const { content } = await res.json();

      // 6. Accumulate into session-wide context, numbered by capture order.
      // Reset acknowledged so the physician reacts to the new addition.
      screenCaptureCountRef.current += 1;
      const captureLabel = `[Screen ${screenCaptureCountRef.current}]`;
      screenAcknowledgedRef.current = false;
      setPendingScreenContext(prev =>
        prev ? `${prev}\n\n---\n\n${captureLabel}\n${content}` : `${captureLabel}\n${content}`
      );

      // 7. Add a visual notification card in the transcript
      const screenMsg: Message = {
        id: `screen_${Date.now()}`,
        role: 'user',
        content: content,
        isScreenShare: true,
      };
      setMessages((prev) => [...prev, screenMsg]);
      messagesRef.current = [...messagesRef.current, screenMsg];
    } catch (err: any) {
      // User cancelled the picker — ignore silently; any real error → log
      if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') {
        console.error('[screen-reader] capture failed:', err?.message);
      }
    } finally {
      setScreenCapturing(false);
    }
  };

  const handleNewSession = () => {
    stopCurrentAudio();
    cleanupAvatar();

    sessionEndedRef.current = false;
    autoEndedRef.current = false;
    greetingDeliveredRef.current = false;
    greetingStartedRef.current = false;
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
    setGreetingDelivered(false);
    setLoading(false);
    setSessionStarted(false);
    setTtsAvailable(true);
    setEvalReady(false);
    setEvalGenerating(false);
    setEvalRefreshTrigger(0);
    setShowTranscript(false);
    setPendingScreenContext(null);
    screenAcknowledgedRef.current = false;
    screenCaptureCountRef.current = 0;
    stopCamera();
    capturedFramesRef.current = [];
    setFacialAnalysis(null);
    setFacialAnalysisRunning(false);
    pendingPhysicianRef.current = null;
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
    setAvatarStreamActive(false);
    avatarStreamActiveRef.current = false;
    setAvatarConnecting(false);
  };

  // ── Anam avatar helpers ─────────────────────────────────────────────────────

  const cleanupAnam = async () => {
    if (anamControllerRef.current) {
      try { await anamControllerRef.current.cleanup(); } catch {}
      anamControllerRef.current = null;
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
    setAvatarStreamActive(false);
    avatarStreamActiveRef.current = false;
    setAvatarConnecting(false);
  };

  // Provider-agnostic teardown — safe to call regardless of which (if any)
  // provider is connected; each helper no-ops when there's nothing to clean.
  const cleanupAvatar = async () => {
    await cleanupTavus();
    await cleanupAnam();
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
    if (sessionEndedRef.current) cleanupAvatar();
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
    // Primary unlock: conversation.replica.stopped_speaking app-message.
    // Secondary unlock: audio track.onmute event (see track-started handler).
    // Fallback: word-count estimate — fires if neither primary nor secondary
    // triggers arrive (e.g. network drop, Tavus API version change).
    // 200 ms/word ≈ 300 WPM; +1 200 ms covers TTS synthesis + network startup.
    // Minimum 2 000 ms so very short responses don't race the TTS pipeline.
    const wordCount = text.split(/\s+/).length;
    avatarSpeakFallbackRef.current = setTimeout(
      clearAvatarSpeakingLock,
      Math.max(2000, wordCount * 200 + 1200),
    );
  };

  // Anam echo mode: client.talk() makes the persona speak the exact text using
  // its pre-configured voice model. Anam exposes no public "talk finished"
  // event, so the mic re-opens via a word-count estimate (a touch more generous
  // than Tavus's, which also has the replica.stopped_speaking signal as primary).
  // ~320 ms/word ≈ 185 WPM; +1 500 ms covers synthesis + WebRTC startup.
  const speakViaAnam = (text: string) => {
    const ctrl = anamControllerRef.current;
    if (!ctrl) return;
    avatarSpeakingRef.current = true;
    setAvatarSpeaking(true); // mute AudioInput while avatar speaks
    ctrl.talk(text).catch((err) => console.error('[anam] talk failed:', err));
    const wordCount = text.split(/\s+/).length;
    if (avatarSpeakFallbackRef.current) clearTimeout(avatarSpeakFallbackRef.current);
    avatarSpeakFallbackRef.current = setTimeout(
      clearAvatarSpeakingLock,
      Math.max(2500, wordCount * 320 + 1500),
    );
  };

  // Provider-agnostic echo: speak the given text through whichever avatar
  // provider is active for this session.
  const speakViaAvatar = (text: string) => {
    if (avatarProviderRef.current === AvatarProvider.ANAM) speakViaAnam(text);
    else speakViaTavus(text);
  };

  const initTavusAvatar = async (physician: any): Promise<boolean> => {
    setAvatarConnecting(true);
    try {
      const res = await fetch('/api/tavus/conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          physicianName: `${physician.FIRST_NAME} ${physician.LAST_NAME}`,
          gender:    physician.GENDER    ?? null,   // 'M' | 'F' from Snowflake
          firstName: physician.FIRST_NAME ?? null,  // fallback when gender is absent
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

          // Secondary mic-unlock: fires when the Tavus audio track goes silent
          // (i.e. the avatar has stopped sending audio data). Acts as a reliable
          // backup for the replica.stopped_speaking app-message, which can be
          // delayed or missed on slow connections.
          // Guard: only acts if avatarSpeakingRef is still true (prevents
          // false triggers during brief mid-sentence network gaps by
          // requiring it to be an intentional mute from the sender).
          track.addEventListener('mute', () => {
            if (avatarSpeakingRef.current) {
              console.log('[tavus] audio track muted — unlocking mic (secondary trigger)');
              clearAvatarSpeakingLock();
            }
          });
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
      setAvatarStreamActive(true);
      avatarStreamActiveRef.current = true;

      // Drain any physician speech that arrived while Daily.co was still
      // connecting (happens in parallel-init mode when the LLM responds in
      // < 3 s and daily.join takes 3–5 s).
      if (pendingSpeechRef.current) {
        const pending = pendingSpeechRef.current;
        pendingSpeechRef.current = null;
        speakViaTavus(pending);
      }

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

  const initAnamAvatar = async (physician: any): Promise<boolean> => {
    setAvatarConnecting(true);
    try {
      // ── Step 1: server picks a gender-matched persona + mints a session token
      console.log(`[anam] initAnamAvatar — physician.GENDER="${physician.GENDER ?? 'null'}" firstName="${physician.FIRST_NAME ?? 'null'}"`);
      const res = await fetch('/api/anam/session-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          physicianName: `${physician.FIRST_NAME} ${physician.LAST_NAME}`,
          gender: physician.GENDER ?? null,
          firstName: physician.FIRST_NAME ?? null,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = (errBody as any)?.error ?? `HTTP ${res.status}`;
        console.error('[anam] API error:', msg, (errBody as any)?.details ?? '');
        throw new Error(msg);
      }
      const { sessionToken, personaId } = await res.json();
      console.log('[anam] session token acquired — persona:', personaId);

      // ── Step 2: init the Anam SDK client and stream into the shared <video>
      const { AnamController } = await import('@/lib/avatar/anam-controller');
      const ctrl = new AnamController();
      anamControllerRef.current = ctrl;

      // Gate session start on the avatar actually appearing (or a 12 s timeout).
      let resolveVideoReady!: () => void;
      const videoReadyPromise = new Promise<void>((r) => { resolveVideoReady = r; });
      let videoReadyTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        console.warn('[anam] video-play timeout — proceeding without confirmed video');
        resolveVideoReady();
      }, 12_000);

      await ctrl.init({
        sessionToken,
        videoElementId: 'avatar-video',
        onVideoReady: () => {
          if (videoReadyTimeout !== null) { clearTimeout(videoReadyTimeout); videoReadyTimeout = null; }
          resolveVideoReady();
        },
        onConnectionClosed: (reason) => {
          console.warn('[anam] connection closed:', reason);
        },
        // TALK_STREAM_INTERRUPTED fires when the avatar finishes its current
        // speech turn — use it to unlock the mic immediately (cancels the
        // word-count fallback timer, which would otherwise keep the mic locked
        // for 10–30 s).
        onTalkStreamInterrupted: () => {
          console.log('[anam] talk stream interrupted/finished — clearing speaking lock');
          clearAvatarSpeakingLock();
        },
      });

      await videoReadyPromise;

      // Ensure the Tavus opacity gate is off; flip on the generic stream flag.
      setTavusConvId(null);
      tavusConvIdRef.current = null;
      setAvatarStreamActive(true);
      avatarStreamActiveRef.current = true;

      // Always interrupt the persona immediately on stream activation.
      // The Anam SDK's skipGreeting flag is not honoured by this SDK version,
      // so the persona plays a pre-recorded Spanish greeting on connect.
      // interruptPersona() silences it instantly; the English physician opening
      // line will be spoken either from pendingSpeechRef (if the LLM already
      // responded) or directly via speakViaAvatar when the done event fires.
      ctrl.interrupt();
      console.log('[anam] interrupted pre-recorded greeting on stream activation');

      // Drain any physician speech buffered while Anam was connecting.
      if (pendingSpeechRef.current) {
        const pending = pendingSpeechRef.current;
        pendingSpeechRef.current = null;
        speakViaAnam(pending);
      }

      setAvatarConnecting(false);
      return true;
    } catch (err) {
      console.error('[anam] init failed:', err);
      await cleanupAnam();
      setAvatarConnecting(false);
      setAvatarEnabled(false);
      avatarEnabledRef.current = false;
      // Avatar unavailable — fall back to audio-only mode automatically.
      setVoiceEnabled(true);
      voiceEnabledRef.current = true;
      return false;
    }
  };

  // Provider-agnostic init — dispatches to the active provider's SDK setup.
  const initAvatar = async (physician: any): Promise<boolean> => {
    return avatarProviderRef.current === AvatarProvider.ANAM
      ? initAnamAvatar(physician)
      : initTavusAvatar(physician);
  };

  // True when the active provider currently has a live avatar connection.
  const isAvatarConnected = (): boolean =>
    avatarProviderRef.current === AvatarProvider.ANAM
      ? anamControllerRef.current !== null
      : dailyCallRef.current !== null;

  // ── Back to physician list (no eval triggered) ────────────────────────────
  const handleBackToPhysicianList = () => {
    stopCurrentAudio();
    cleanupAvatar();
    setHoveredBtnKey(null); // reset any stuck hover style on action buttons

    // Prevent timer and any in-flight message from triggering eval
    autoEndedRef.current = true;
    sessionEndedRef.current = true;

    // Reset refs
    hasStarted.current = false;
    roleplayingRef.current = false;
    greetingDeliveredRef.current = false;
    greetingStartedRef.current = false;
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
    setGreetingDelivered(false);
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
          {/* ── Camera setup modal (shown after consent accept) ─────────── */}
          <CameraSetupModal
            open={cameraSetupOpen}
            onConfirm={handleSetupConfirm}
            onSkip={handleSetupSkip}
          />

          {/* ── Consent modal ───────────────────────────────────────────── */}
          {consentModalOpen && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', padding: '1rem' }} onClick={handleConsentDecline}>
              <div className="bg-white rounded-2xl shadow-2xl p-6 flex flex-col gap-4" style={{ maxWidth: '28rem', width: '100%' }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-slate-100"><Camera className="w-4 h-4 text-slate-600" /></div>
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Optional Feature</span>
                </div>
                <p className="text-lg font-bold text-slate-900">Facial Expression Analysis</p>
                <p className="text-sm text-slate-600 leading-relaxed">PitchMD can analyse your facial expressions and include a <strong>Confidence</strong>, <strong>Nervousness</strong>, and <strong>Engagement</strong> assessment in your evaluation report.</p>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-slate-600 leading-relaxed"><span className="font-semibold text-slate-700">No video is stored.</span> Periodic still frames are sent to an AI model for analysis only.</p>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <ToggleLeft className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-slate-600 leading-relaxed"><span className="font-semibold text-slate-700">You can turn it off at any time.</span> A camera button lets you disable capture mid-session.</p>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <Trash2 className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-slate-600 leading-relaxed"><span className="font-semibold text-slate-700">Consent is per-session.</span> You will be asked each time you start a new session.</p>
                  </div>
                </div>
                <div className="flex gap-3 mt-2">
                  <button onClick={handleConsentAccept} className="flex-1 h-10 rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-sm font-medium flex items-center justify-center gap-2">
                    <Camera className="w-3.5 h-3.5" />Enable Camera
                  </button>
                  <button onClick={handleConsentDecline} className="flex-1 h-10 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50">
                    Continue Without Camera
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* ── Header ──────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
            <div>
              <p className="text-xl font-semibold tracking-tight text-slate-900">Select a Physician</p>
              <p className="text-sm text-slate-400 mt-0.5">Choose who you'd like to practice with today</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Avatar provider toggle — applies to the next session you start */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
                  <Video className="w-3.5 h-3.5" />
                  Avatar
                </span>
                {/* Segmented control: fixed-width segments + sliding white pill */}
                <div className="relative inline-flex items-center rounded-full bg-slate-300 p-0.5">
                  {/* Sliding pill — translates one segment-width (w-14 = 3.5rem) on toggle */}
                  <div
                    className="absolute top-0.5 bottom-0.5 left-0.5 w-14 rounded-full bg-white shadow-sm"
                    style={{
                      transition: 'transform 200ms cubic-bezier(0.34, 1.2, 0.64, 1)',
                      transform: avatarProvider === AvatarProvider.ANAM
                        ? 'translateX(3.5rem)'
                        : 'translateX(0)',
                    }}
                  />
                  {/* Option labels — sit on top of the pill via z-10 */}
                  {([AvatarProvider.TAVUS, AvatarProvider.ANAM] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setAvatarProvider(p)}
                      className={`relative z-10 w-14 py-1 rounded-full text-xs font-semibold select-none transition-colors duration-150 ${
                        avatarProvider === p ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'
                      }`}
                      title={`Use ${p === AvatarProvider.TAVUS ? 'Tavus' : 'Anam'} avatars for new sessions`}
                    >
                      {p === AvatarProvider.TAVUS ? 'Tavus' : 'Anam'}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={() => setPhysicianSelectionMode(false)} className="text-sm text-slate-400 hover:text-slate-700 px-3 py-1 rounded-full hover:bg-slate-100 transition-colors">
                Back
              </button>
            </div>
          </div>

          {/* ── Filter ribbon ───────────────────────────────────────────── */}
          <div className="shrink-0 px-4 py-2.5 border-b border-slate-200 bg-slate-100/80">
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

              {/* Specialty */}
              <PhysicianFilterDropdown label="Specialty" options={uniqueSpecialties}
                activeFilters={filterValues.specialty}
                onFilter={vals => setFilterValues(prev => ({ ...prev, specialty: vals }))}
                isOpen={openDropdown === 'specialty'}
                onOpen={() => setOpenDropdown('specialty')}
                onClose={() => setOpenDropdown(v => v === 'specialty' ? null : v)}
              />
              {/* Segment */}
              <PhysicianFilterDropdown label="Segment" options={uniqueSegments}
                activeFilters={filterValues.segment}
                onFilter={vals => setFilterValues(prev => ({ ...prev, segment: vals }))}
                isOpen={openDropdown === 'segment'}
                onOpen={() => setOpenDropdown('segment')}
                onClose={() => setOpenDropdown(v => v === 'segment' ? null : v)}
              />
              {/* Mindset */}
              <PhysicianFilterDropdown
                label="Mindset"
                options={[...PRESET_MINDSETS, 'Custom', 'Not Assigned']}
                activeFilters={filterValues.mindset}
                onFilter={vals => setFilterValues(prev => ({ ...prev, mindset: vals }))}
                isOpen={openDropdown === 'mindset'}
                onOpen={() => setOpenDropdown('mindset')}
                onClose={() => setOpenDropdown(v => v === 'mindset' ? null : v)}
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
          <div className="shrink-0 h-px" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.14) 0%, transparent 100%)', height: '8px', pointerEvents: 'none' }} />
          <div className="flex-1 overflow-auto">
            {physicianHook.loading ? (
              <div className="flex items-center justify-center h-40 gap-2 text-slate-400">
                <Spinner className="w-4 h-4" />
                <span className="text-sm">Loading physicians...</span>
              </div>
            ) : filteredPhysicians.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-slate-400">
                <p className="text-sm font-medium">No physicians match your filters.</p>
                <button onClick={() => { physicianHook.setSearch(''); setFilterValues(EMPTY_FILTERS); setSortConfig(null); }} className="text-xs text-blue-500 hover:underline">Clear filters</button>
              </div>
            ) : (
              <table className="w-full text-base border-collapse min-w-[700px]">
                <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_0_#e2e8f0]">
                  <tr>
                    {([
                      { label: 'Physician ID', field: 'physicianId',   align: 'left',   tooltip: null },
                      { label: 'Physician',    field: 'name',          align: 'left',   tooltip: null },
                      { label: 'Specialty',    field: 'specialty',     align: 'left',   tooltip: null },
                      { label: 'Segment',  field: 'segment',       align: 'left',   tooltip: null },
                      { label: 'Mindset',  field: 'mindset',       align: 'left',   tooltip: 'Hover to assign a mindset persona for this practice session' },
                      { label: 'Score',    field: 'overallScore',  align: 'center', tooltip: 'Median score across your 3 most recent sessions with the physician' },
                      { label: 'Readiness',field: 'fieldReadiness',align: 'left',   tooltip: 'Most frequent readiness rating across your 3 most recent sessions with the physician' },
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
                      if (val === 'Field Ready')   return { background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' };
                      if (val === 'Not Ready')     return { background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' };
                      if (val === 'Approaching')   return { background: '#fefce8', color: '#a16207', border: '1px solid #fde68a' };
                      return { background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0' };
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

                        {/* Mindset */}
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

          <EvaluationPanel open={evalOpen} onClose={() => setEvalOpen(false)} content="" username={username} physicianId={evalPhysicianId} facialAnalysis={facialAnalysis} facialAnalysisRunning={facialAnalysisRunning} />

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
                    <p className="text-base font-semibold text-slate-900">Custom Mindset</p>
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
      accentColor = '',
    ) => {
      const active = !!action;
      const isHovered = hoveredSplashBtn === label;
      return (
        <button
          key={label}
          onClick={action}
          disabled={!active}
          style={isHovered ? { background: 'linear-gradient(135deg, #C47B42, #C49868, #45A8C8)' } : {}}
          onMouseEnter={() => { if (active) setHoveredSplashBtn(label); }}
          onMouseLeave={() => setHoveredSplashBtn(null)}
          className={`relative overflow-hidden flex items-center gap-5 rounded-2xl border px-6 py-12 text-left transition-all duration-200 ${
            active
              ? 'border-slate-200 bg-[#F1EFE9] shadow-[0_1px_4px_rgba(0,0,0,0.05),0_4px_16px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08),0_12px_32px_rgba(0,0,0,0.06)] hover:-translate-y-0.5 cursor-pointer'
              : 'border-slate-100 bg-[#F1EFE9]/60 cursor-not-allowed'
          } ${extraClass}`}
        >

          {/* Icon */}
          <div className={`shrink-0 transition-colors ${
            active ? (isHovered ? 'text-white' : 'text-slate-500') : 'text-slate-300'
          }`}>
            {icon}
          </div>

          {/* Text */}
          <div className="flex flex-col justify-between min-w-0 gap-3">
            <span
              className={`text-xs font-semibold uppercase tracking-widest transition-colors ${
                active ? (isHovered ? 'text-white/70' : '') : 'text-slate-300'
              }`}
              style={active && !isHovered && accentColor ? { color: accentColor } : {}}
            >
              {badge}
            </span>
            <p className={`font-semibold text-base leading-snug transition-colors ${
              active ? (isHovered ? 'text-white' : 'text-slate-800') : 'text-slate-400'
            }`}>
              {label}
            </p>
            <p className={`text-sm leading-snug transition-colors ${
              active ? (isHovered ? 'text-white/80' : 'text-slate-500') : 'text-slate-300'
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
      <div className="relative flex flex-col h-full items-center justify-center px-6 py-6">

        {/* ── Roadmap — bottom-left of home screen only ─────────────────── */}
        <div className="absolute bottom-4 left-4 z-20" ref={roadmapRef}>
          <button
            onClick={() => setRoadmapOpen(prev => !prev)}
            title="Product Roadmap"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors shadow-sm ${
              roadmapOpen
                ? 'border-orange-300 bg-orange-50 text-orange-600'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            <Map className="w-3.5 h-3.5" />
            Roadmap
          </button>

          {roadmapOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-[480px] bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Product Roadmap</p>
                  <p className="text-xs text-slate-400 mt-0.5">Features coming soon</p>
                </div>
                <button onClick={() => setRoadmapOpen(false)} className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="divide-y divide-slate-50 overflow-y-auto max-h-96">
                {ROADMAP_ITEMS.map((item, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-3.5">
                    <div className="mt-0.5 shrink-0 p-1.5 rounded-lg bg-slate-100 text-slate-500">{item.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-800 leading-snug">{item.title}</p>
                        <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${
                          item.status === 'Live'
                            ? 'text-emerald-700 bg-emerald-50 border-emerald-100'
                            : item.status === 'Pending Testing'
                              ? 'text-blue-600 bg-blue-50 border-blue-100'
                              : 'text-amber-600 bg-amber-50 border-amber-100'
                        }`}>{item.status}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500 leading-relaxed">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

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
              '#BF4E19',
            )}
            {splashTile(
              'Review Performance',
              'See your scores and detailed feedback from recent sessions.',
              <BarChart2 className="w-7 h-7" />,
              'Pre-Field',
              () => setPerformanceMode(true),
              'flex-1',
              '#BF4E19',
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
              '#2B5FA6',
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
              '#0D8A78',
            )}
            {splashTile(
              'Loop Back',
              'Track commitments made during your calls and follow through on every promise.',
              <RotateCcw className="w-7 h-7" />,
              'Post-Field',
              () => setLoopBackMode(true),
              'flex-1',
              '#0D8A78',
            )}
          </div>

        </div>

        <EvaluationPanel
          open={evalOpen}
          onClose={() => setEvalOpen(false)}
          content=""
          username={username}
          physicianId={evalPhysicianId}
          facialAnalysis={facialAnalysis}
          facialAnalysisRunning={facialAnalysisRunning}
        />


      </div>
    );
  }

  // ── Active session ────────────────────────────────────────────────────────
  return (
    <div className="relative flex flex-col h-full min-h-0">

      {/* ── Avatar area — dark stage with centered square window ───────────── */}
      {/* The outer div fills remaining vertical space and acts as a dark stage.
          Inside it, an inner square div (max 520 px, aspect-ratio 1:1) contains
          the video and all avatar UI.  This prevents the video from stretching
          across the full screen width while keeping the dark "room" feel. */}
      <div className="flex-1 relative min-h-0 flex flex-col items-center justify-center overflow-hidden" style={{ background: '#010610' }}>

        {/* ── Depth background: atmospheric glow + vignette + grain ─────────────
            Three layers create genuine spatial depth:
            1. Vignette     — edge darkness, lens fall-off
            2. Center glow  — soft ambient light on the physician's plane;
                              no shapes/blobs, just a tonal gradient that makes
                              the centre feel closer than the receding edges
            3. Grain        — film texture sits on top, visible throughout     */}

        {/* 1. Vignette — darkens edges, creates lens falloff */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 75% 65% at 50% 44%, transparent 18%, rgba(0,1,10,0.92) 100%)' }}
        />

        {/* 2. Atmospheric centre glow — featureless, no bokeh circles.
            Implies ambient light on the physician space; edges stay dark.
            Blue-navy tint (matches app accent) reinforces the space's colour. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: [
              'radial-gradient(ellipse 65% 75% at 50% 44%, rgba(28,68,140,0.82) 0%, rgba(12,30,72,0.45) 50%, transparent 75%)',
              'radial-gradient(ellipse 40% 35% at 50% 22%, rgba(40,88,175,0.38) 0%, transparent 68%)',
            ].join(', '),
          }}
        />

        {/* 3. Film grain — topmost so it textures the whole lit-and-dark space */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C%2Ffilter%3E%3Crect width='256' height='256' filter='url(%23g)'/%3E%3C%2Fsvg%3E")`,
            backgroundRepeat: 'repeat',
            backgroundSize: '256px 256px',
            opacity: 0.28,
          }}
        />

        {/* Back button — pinned to the top-right corner of the dark stage */}
        <div className="absolute top-3 right-3 z-40">
          <button
            onClick={handleBackToPhysicianList}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-sm font-medium px-3 py-1.5 rounded-full transition-all backdrop-blur-sm"
          >
            Back
          </button>
        </div>

        {/* ── Square avatar window ─────────────────────────────────────────
            All avatar content (video, overlays, nameplate) lives inside this
            constrained square so it never stretches wall-to-wall.
            max-w-[520px]  → caps width at 520 px on wide screens
            aspect-square  → height always equals width (1:1)
            max-h-[calc(100%-1rem)] → prevents overflow on short screens;
              browser reduces both dimensions to satisfy aspect-ratio       */}
        <div
          className="relative aspect-square w-full max-w-[520px] overflow-hidden rounded-2xl border border-white/5"
          style={{ maxHeight: 'calc(100% - 1rem)' }}
        >

          {/* ── Avatar video ── Tavus uses srcObject; Anam targets by id ─── */}
          <video
            id="avatar-video"
            ref={avatarVideoRef}
            autoPlay
            playsInline
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${avatarEnabled && avatarStreamActive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          />

          {/* Gradient fill when avatar is disabled */}
          {!avatarEnabled && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center select-none pointer-events-none"
              style={{
                background: 'linear-gradient(120deg, #C47B42, #C49868, #45A8C8, #3A8FB5, #C47B42)',
                backgroundSize: '400% 400%',
                animation: 'gradientShift 10s ease infinite',
              }}
            >
              <VideoOff className="w-10 h-10 text-white/20 mb-2" />
              <p className="text-white/25 text-xs tracking-widest uppercase">Avatar disabled</p>
            </div>
          )}

          {/* Connecting overlay */}
          {avatarConnecting && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-20">
              <div className="bg-white/90 backdrop-blur-sm px-5 py-3 rounded-2xl flex items-center gap-3 shadow">
                <Spinner className="w-4 h-4 text-gray-600" />
                <span className="text-sm text-gray-700">Connecting avatar…</span>
              </div>
            </div>
          )}

          {/* Session start loading */}
          {messages.length === 0 && loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="bg-white/80 backdrop-blur-sm px-5 py-3 rounded-2xl flex items-center gap-3 shadow">
                <Spinner className="w-4 h-4 text-gray-600" />
                <span className="text-sm text-gray-700">{statusMessage || 'Starting session...'}</span>
              </div>
            </div>
          )}

          {/* Nameplate moved outside the avatar square — rendered below */}

          {/* Screen share notification — shows what was read from the screen */}
          {pendingScreenContext && (
            <div className="absolute bottom-3 left-3 right-3 z-20">
              <div className="px-3.5 py-2.5 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-100 text-xs shadow-lg backdrop-blur-sm">
                <div className="flex items-center gap-1.5 mb-1">
                  <Monitor className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">
                    {screenCaptureCountRef.current > 1
                      ? `${screenCaptureCountRef.current} screens shared · Send a message to continue`
                      : 'Screen shared · Send a message to continue'}
                  </span>
                </div>
                <p className="line-clamp-2 text-emerald-100/70 leading-relaxed">{pendingScreenContext}</p>
              </div>
            </div>
          )}

          {/* Compliance block notices — higher z so they overlay the nameplate */}
          {visibleMessages.filter(m => m.isComplianceBlock).slice(-1).map(m => (
            <div key={m.id} className="absolute bottom-3 left-3 right-3 z-20">
              <div className="px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm shadow-lg">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-500">
                    Compliance Notice{m.complianceRuleCode && ` · ${m.complianceRuleCode}`}
                  </span>
                </div>
                {m.content}
              </div>
            </div>
          ))}

        </div>
        {/* END square avatar window */}

        {/* Physician nameplate — below the avatar square, on the gradient stage */}
        {selectedPhysician && (
          <div className="mt-4 mb-1 text-center pointer-events-none select-none">
            <p className="text-white font-semibold text-base leading-tight tracking-wide" style={{ textShadow: '0 1px 12px rgba(37,99,235,0.5)' }}>
              {selectedPhysician.name}
            </p>
            {(selectedPhysician.specialty || selectedPhysician.segment) && (
              <p className="text-white/50 text-xs mt-1 tracking-widest uppercase font-medium">
                {[selectedPhysician.specialty, selectedPhysician.segment].filter(Boolean).join(' · ')}
              </p>
            )}
            {physicianMindsets[physicianIdRef.current ?? ''] && (
              <p className="mt-2.5 inline-flex items-center gap-1 text-[10px] font-semibold text-violet-200/90 bg-violet-900/50 border border-violet-600/40 px-3 py-0.5 rounded-full backdrop-blur-sm tracking-wide">
                {physicianMindsets[physicianIdRef.current ?? '']}
              </p>
            )}
          </div>
        )}

        {/* ── Transcript overlay — slides over avatar when showTranscript=true ── */}
        {showTranscript && (
          <div className="absolute inset-0 z-30 flex flex-col bg-black/85 backdrop-blur-sm">
            {/* Header */}
            <div className="shrink-0 px-4 py-2.5 border-b border-white/10 flex items-center justify-between">
              <span className="text-white/80 text-xs font-semibold uppercase tracking-wider">Conversation Transcript</span>
              <button
                onClick={() => setShowTranscript(false)}
                className="text-white/50 hover:text-white/80 transition-colors"
                title="Close transcript"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Message list */}
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
              {visibleMessages.length === 0 ? (
                <p className="text-white/30 text-sm text-center mt-8">Conversation will appear here as you practice.</p>
              ) : (
                visibleMessages.map((m) => (
                  m.isScreenShare ? (
                    <div key={m.id} className="flex flex-col items-center">
                      <div className="flex items-center gap-1.5 text-[10px] text-emerald-300/80 mb-1 uppercase tracking-widest font-semibold">
                        <Monitor className="w-3 h-3" />
                        Screen shared
                      </div>
                      <div className="max-w-[90%] px-3 py-2 rounded-xl text-xs leading-relaxed bg-emerald-900/40 border border-emerald-500/30 text-emerald-100/80 italic">
                        {m.content}
                      </div>
                    </div>
                  ) : m.isComplianceFlag ? (
                    // Amber inline training notice — rep was flagged but physician still responds
                    <div key={m.id} className="flex flex-col items-center">
                      <div className="flex items-center gap-1.5 text-[10px] text-amber-300/90 mb-1 uppercase tracking-widest font-semibold">
                        <ShieldAlert className="w-3 h-3" />
                        Compliance Notice{m.complianceRuleCode ? ` · ${m.complianceRuleCode}` : ''}
                      </div>
                      <div
                        className="max-w-[90%] px-3 py-2 rounded-xl text-xs leading-relaxed border"
                        style={{ background: 'rgba(217,119,6,0.15)', borderColor: 'rgba(217,119,6,0.35)', color: 'rgba(253,230,138,0.9)' }}
                      >
                        {m.content}
                      </div>
                    </div>
                  ) : (
                  <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <p className="text-[10px] text-white/40 mb-0.5 px-1">
                      {m.role === 'user' ? 'You' : (selectedPhysician?.name ?? 'Physician')}
                    </p>
                    <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-blue-600/60 text-white/95'
                        : m.isComplianceBlock
                          ? 'bg-amber-500/30 text-amber-100 border border-amber-400/30'
                          : 'bg-white/10 text-white/90'
                    }`}>
                      {m.content}
                    </div>
                  </div>
                  )
                ))
              )}
            </div>
          </div>
        )}

        {/* Eval status — top-center so it doesn't clash with nameplate */}
        {evalGenerating && !evalReady && (
          <div className="absolute top-14 left-0 right-0 flex justify-center z-10 px-4">
            <div className="flex items-center gap-2.5 bg-white/10 backdrop-blur-sm text-white/80 text-sm font-medium px-4 py-2 rounded-xl border border-white/10">
              <Spinner className="w-3.5 h-3.5 text-white/60 shrink-0" />
              <span>Session complete · Generating evaluation report…</span>
            </div>
          </div>
        )}
        {evalReady && (
          <div className="absolute top-14 left-0 right-0 flex justify-center z-10 px-4">
            <div className="flex items-center gap-3 bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-xl shadow-lg">
              <span>Evaluation report ready.</span>
              <button
                onClick={() => { setEvalPhysicianId(physicianIdRef.current); setEvalOpen(true); }}
                className="underline underline-offset-2 hover:no-underline font-bold"
              >
                View
              </button>
              <button onClick={() => setEvalReady(false)} className="ml-1 opacity-70 hover:opacity-100">×</button>
            </div>
          </div>
        )}

      </div>

      {/* ── Bottom bar ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 pt-3 pb-4" style={{ background: 'rgba(252,252,253,0.97)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', borderTop: '1px solid rgba(0,0,0,0.06)' }}>

        {/* Row 1 — centred controls: timer · transcript · mic · end-session */}
        <div className="flex items-center justify-center gap-2.5 mb-3">

          {/* Hourglass timer ring — visible while session is running */}
          {timeRemaining !== null && sessionDuration !== null && (() => {
            const ringColor = timerRatio !== null && timerRatio > 2/3 ? '#22c55e' : timerRatio !== null && timerRatio > 1/3 ? '#f97316' : '#ef4444';
            return (
              <div className="relative w-10 h-10 shrink-0" title={`${timeRemaining}s remaining`}>
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 44 44">
                  <circle cx="22" cy="22" r={18} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="3" />
                  <circle
                    cx="22" cy="22" r={18} fill="none"
                    stroke={ringColor} strokeWidth="3"
                    strokeDasharray={2 * Math.PI * 18}
                    strokeDashoffset={timerRatio !== null ? 2 * Math.PI * 18 * (1 - timerRatio) : 0}
                    strokeLinecap="round"
                    transform="rotate(-90 22 22)"
                    style={{ transition: 'stroke-dashoffset 1s linear, stroke 1s ease' }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Hourglass className="w-3.5 h-3.5" style={{ color: ringColor }} />
                </div>
              </div>
            );
          })()}

          {/* Camera toggle — stops/resumes facial capture mid-session */}
          {roleplaying && !sessionEnded && cameraActive !== undefined && capturedFramesRef.current !== undefined && (
            cameraActive ? (
              <Button
                type="button" size="icon" variant="ghost"
                onClick={stopCamera}
                className="h-9 w-9 rounded-full shrink-0 text-emerald-500 hover:text-red-500 hover:bg-red-50 transition-all duration-150"
                title="Camera on — click to turn off facial capture"
              >
                <Camera className="w-4 h-4" />
              </Button>
            ) : null
          )}

          {/* Screen share button — captures screen and feeds content to physician */}
          {roleplaying && !sessionEnded && (
            <Button
              type="button" size="icon" variant="ghost"
              onClick={handleScreenCapture}
              disabled={screenCapturing}
              className={`h-9 w-9 rounded-full shrink-0 transition-all duration-150 ${
                pendingScreenContext
                  ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200 hover:bg-emerald-600'
                  : screenCapturing
                    ? 'text-blue-400 hover:bg-gray-100'
                    : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
              }`}
              title={pendingScreenContext
                ? screenCaptureCountRef.current > 1
                  ? `${screenCaptureCountRef.current} screens shared — physician will see all on your next message`
                  : 'Screen shared — physician will see it on your next message'
                : 'Share screen with physician'}
            >
              {screenCapturing
                ? <Spinner className="w-3.5 h-3.5" />
                : <Monitor className="w-4 h-4" />}
            </Button>
          )}

          {/* Transcript toggle — solid blue fill when open */}
          <Button
            type="button" size="icon" variant="ghost"
            onClick={() => setShowTranscript((v) => !v)}
            className={`h-9 w-9 rounded-full shrink-0 transition-all duration-150 ${
              showTranscript
                ? 'bg-blue-500 text-white shadow-lg shadow-blue-200 hover:bg-blue-600'
                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
            }`}
            title={showTranscript ? 'Hide transcript' : 'Show transcript'}
          >
            <MessageSquare className="w-4 h-4" />
          </Button>

          {/* Microphone */}
          <AudioInput
            onTranscript={(text) => {
              const corrected = correctorRef.current(text);
              if (corrected !== text) console.log(`[corrector] Whisper: "${text}" → "${corrected}"`);
              setInputValue((prev) => prev + (prev ? ' ' : '') + corrected);
            }}
            onAutoSubmit={handleAutoSubmit}
            onCountdown={(pct) => setTranscriptCountdownActive(pct !== null)}
            userTyping={userTyping}
            disabled={sessionEnded || !roleplaying || avatarSpeaking}
          />

          {/* End / New session */}
          {sessionEnded ? (
            <Button
              type="button" variant="ghost" size="icon"
              onClick={handleNewSession}
              title="New session"
              className="h-9 w-9 rounded-full shrink-0 text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-all duration-150"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              type="button" variant="ghost" size="icon"
              onClick={() => sendMessage('done', messagesRef.current)}
              disabled={sessionEnded}
              className="h-9 w-9 rounded-full shrink-0 text-gray-400 hover:text-white hover:bg-red-500 hover:shadow-lg hover:shadow-red-200 transition-all duration-150"
              title="End session"
            >
              <PhoneOff className="w-4 h-4" />
            </Button>
          )}
        </div>

        {/* Row 2 — pill centred at max-w-2xl; voice/video pinned to far right */}
        <div className="relative flex items-center justify-center">
          <form onSubmit={handleSubmit} className="flex gap-2 items-center w-full max-w-2xl">
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
              disabled={sessionEnded}
              className="flex-1 resize-none overflow-hidden rounded-full border border-gray-200/80 bg-white/90 px-5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400/80 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:border-blue-300 disabled:cursor-not-allowed disabled:opacity-40 leading-5 min-h-[40px] max-h-40 transition-all duration-200"
            />
            <Button
              type="submit"
              disabled={loading || !inputValue.trim() || sessionEnded}
              size="icon"
              className="rounded-full shrink-0 w-9 h-9 bg-gray-900 hover:bg-gray-700 text-white shadow-sm disabled:opacity-25 transition-all duration-150 hover:scale-105 active:scale-95"
            >
              <ArrowUp className="w-4 h-4" />
            </Button>
          </form>

          {/* Voice / Video — absolute right edge, secondary controls */}
          <div className="absolute right-0 flex items-center gap-0.5">
            {!ttsAvailable && (
              <span className="text-xs text-amber-400 mr-1" title="TTS unavailable">🔇</span>
            )}
            <Button
              type="button" size="icon" variant="ghost"
              onClick={() => {
                const next = !voiceEnabledRef.current;
                voiceEnabledRef.current = next;
                setVoiceEnabled(next);
                if (!next) stopCurrentAudio();
              }}
              className={`h-8 w-8 rounded-full transition-all duration-150 ${voiceEnabled ? 'text-gray-500 hover:text-gray-800 hover:bg-gray-100' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}
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
                if (next && sessionStarted && selectedPhysicianDataRef.current && !isAvatarConnected()) {
                  await initAvatar(selectedPhysicianDataRef.current);
                } else if (!next) {
                  cleanupAvatar();
                }
              }}
              className={`h-8 w-8 rounded-full transition-all duration-150 ${avatarEnabled ? 'text-blue-500 hover:text-blue-700 hover:bg-blue-50' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}
              title={avatarEnabled ? 'Disable video avatar' : 'Enable video avatar'}
            >
              {avatarEnabled ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Complete Session banner — shown after session ends */}
      {sessionEnded && !completionLogged && sessionIdRef.current && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-white border border-emerald-200 rounded-2xl px-5 py-3 shadow-lg">
          <Check className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="text-sm text-slate-700">Session ended. Acknowledge completion for training records?</span>
          <button
            onClick={async () => {
              try {
                await fetch('/api/sessions/complete', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sessionId: sessionIdRef.current, physicianId: physicianIdRef.current }),
                });
                setCompletionLogged(true);
              } catch { /* silently fail */ }
            }}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors shrink-0"
          >
            Acknowledge &amp; Complete
          </button>
          <button onClick={() => setCompletionLogged(true)} className="text-slate-400 hover:text-slate-600 text-xs">Dismiss</button>
        </div>
      )}
      {sessionEnded && completionLogged && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2 shadow text-sm text-emerald-700">
          <Check className="w-3.5 h-3.5" /> Training completion recorded
        </div>
      )}

      <EvaluationPanel
        open={evalOpen}
        onClose={() => setEvalOpen(false)}
        content=""
        username={username}
        physicianId={evalPhysicianId}
        generating={evalGenerating}
        refreshTrigger={evalRefreshTrigger}
        facialAnalysis={facialAnalysis}
        facialAnalysisRunning={facialAnalysisRunning}
      />

    </div>
  );
}
