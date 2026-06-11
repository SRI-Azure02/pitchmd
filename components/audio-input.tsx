'use client';

/**
 * AudioInput — Vocabulary Enhancement (Phase 5)
 *
 * Uses MediaRecorder to capture audio in 3-second segments and sends each
 * segment to /api/stt (Groq Whisper) with a pharmaceutical vocabulary prompt.
 * Significantly more accurate than the Web Speech API for brand names like
 * Venclexta, Imbruvica, Brukinsa, etc.
 *
 * Behaviour mirrors the previous Web Speech API implementation:
 *  - Recording starts automatically when not disabled
 *  - Each transcribed segment is appended to the input box
 *  - 3-second silence (no new transcript) triggers auto-submit
 *  - Recording pauses while disabled (avatar speaking) and resumes after
 */

import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AudioInputProps {
  onTranscript: (text: string) => void;
  onAutoSubmit?: () => void;
  onCountdown?: (progress: number | null) => void;
  disabled?: boolean;
  userTyping?: boolean;
}

const SEGMENT_MS    = 3000;  // MediaRecorder timeslice — collect data every 3 s
const SUBMIT_WAIT   = 45_000; // ms of transcript silence before auto-submit
const MIN_BLOB_SIZE = 500;   // bytes — smaller blobs are almost certainly silent
const MIN_WORDS     = 1;     // minimum word count to accept a transcript
const RING_R        = 20;
const CIRCUMFERENCE = 2 * Math.PI * RING_R;

/** Pick the best supported MIME type for the current browser */
function pickMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export default function AudioInput({
  onTranscript,
  onAutoSubmit,
  onCountdown,
  disabled,
  userTyping,
}: AudioInputProps) {
  const [isRecording, setIsRecording]   = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [supported, setSupported]       = useState(false);
  const [countdownPct, setCountdownPct] = useState<number | null>(null);

  const recorderRef      = useRef<MediaRecorder | null>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const submitTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const submitStartRef   = useRef<number>(0);
  const activeRef        = useRef(false);   // guards against double-start
  const mimeTypeRef      = useRef('');

  useEffect(() => {
    setSupported(
      typeof MediaRecorder !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia,
    );
  }, []);

  // ── Countdown ring helpers ───────────────────────────────────────────────

  const clearSubmitTimer = () => {
    if (submitTimerRef.current)  clearTimeout(submitTimerRef.current);
    if (progressRef.current)     clearInterval(progressRef.current);
    submitTimerRef.current = null;
    progressRef.current    = null;
    setCountdownPct(null);
    onCountdown?.(null);
  };

  const startSubmitTimer = () => {
    clearSubmitTimer();
    submitStartRef.current = Date.now();
    setCountdownPct(100);
    onCountdown?.(100);

    progressRef.current = setInterval(() => {
      const elapsed   = Date.now() - submitStartRef.current;
      const remaining = Math.max(0, 100 - (elapsed / SUBMIT_WAIT) * 100);
      setCountdownPct(remaining);
      onCountdown?.(remaining);
    }, 50);

    submitTimerRef.current = setTimeout(() => {
      clearSubmitTimer();
      stopRecording();
      onAutoSubmit?.();
    }, SUBMIT_WAIT);
  };

  // ── Transcription ────────────────────────────────────────────────────────

  const transcribeBlob = async (blob: Blob) => {
    if (blob.size < MIN_BLOB_SIZE) return; // almost certainly silent
    setIsProcessing(true);
    try {
      const fd = new FormData();
      fd.append('audio', blob, `audio.${mimeTypeRef.current.includes('mp4') ? 'mp4' : 'webm'}`);
      const res  = await fetch('/api/stt', { method: 'POST', body: fd });
      if (!res.ok) return;
      const data = await res.json() as { transcript: string };
      const text = (data.transcript ?? '').trim();
      if (!text || text.split(/\s+/).length < MIN_WORDS) return;
      onTranscript(text);
      startSubmitTimer(); // reset 3-second silence window
    } catch (err: any) {
      console.error('[audio-input] STT error:', err?.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Recording lifecycle ──────────────────────────────────────────────────

  const startRecording = async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    try {
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mime = pickMimeType();
      mimeTypeRef.current = mime;
      const options: MediaRecorderOptions = mime ? { mimeType: mime } : {};
      const recorder = new MediaRecorder(stream, options);
      recorderRef.current = recorder;
      chunksRef.current   = [];

      // Collect audio in SEGMENT_MS windows
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
          const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' });
          chunksRef.current = []; // reset for next window
          transcribeBlob(blob);
        }
      };

      recorder.onerror = () => { activeRef.current = false; setIsRecording(false); };
      recorder.onstart = () => setIsRecording(true);

      recorder.start(SEGMENT_MS);
    } catch (err: any) {
      console.error('[audio-input] getUserMedia error:', err?.message);
      activeRef.current = false;
    }
  };

  const stopRecording = () => {
    clearSubmitTimer();
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    recorderRef.current  = null;
    streamRef.current    = null;
    chunksRef.current    = [];
    activeRef.current    = false;
    setIsRecording(false);
    setIsProcessing(false);
  };

  // ── Respond to disabled / userTyping changes ─────────────────────────────

  useEffect(() => {
    if (!supported) return;
    if (disabled || userTyping) {
      stopRecording();
    } else {
      // Brief delay — let the browser settle after the avatar stops speaking
      const t = setTimeout(() => startRecording(), 150);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, userTyping, supported]);

  // Stop on unmount
  useEffect(() => () => stopRecording(), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!supported) return null;

  // ── Render ────────────────────────────────────────────────────────────────

  const dashOffset = countdownPct !== null
    ? CIRCUMFERENCE * (1 - countdownPct / 100)
    : CIRCUMFERENCE;

  const isActive = isRecording || isProcessing;

  return (
    <div className="relative shrink-0 w-9 h-9">
      <Button
        type="button"
        size="icon"
        variant={isActive ? 'default' : 'outline'}
        onClick={isActive ? stopRecording : startRecording}
        disabled={disabled}
        className="absolute inset-0 rounded-full"
        style={isActive ? { background: '#ef4444', border: 'none', color: 'white' } : {}}
        title={isActive ? 'Stop recording' : 'Speak your message'}
      >
        <Mic className="w-4 h-4" />
      </Button>

      {/* Countdown ring — visible during submit silence window */}
      {countdownPct !== null && (
        <svg
          className="absolute pointer-events-none"
          style={{ inset: '-4px', width: 'calc(100% + 8px)', height: 'calc(100% + 8px)' }}
          viewBox="0 0 44 44"
        >
          <circle cx="22" cy="22" r={RING_R} fill="none" stroke="#e2e8f0" strokeWidth="2" />
          <circle
            cx="22" cy="22" r={RING_R}
            fill="none" stroke="#FF6B00" strokeWidth="2.5"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform="rotate(-90 22 22)"
            style={{ transition: 'stroke-dashoffset 80ms linear' }}
          />
        </svg>
      )}
    </div>
  );
}
