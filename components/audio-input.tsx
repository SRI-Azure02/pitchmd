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
  onContinuation?: (text: string) => void;
  onCountdown?: (progress: number | null) => void;
  disabled?: boolean;
  userTyping?: boolean;
}

const SEGMENT_MS         = 3000;  // MediaRecorder timeslice — collect data every 3 s
const SUBMIT_WAIT        = 3_000; // ms of transcript silence before auto-submit
const CONTINUATION_WAIT  = 5_000; // ms to keep mic alive after auto-submit for speech continuation
const MIN_BLOB_SIZE  = 500;  // bytes — smaller blobs are almost certainly silent
const MIN_WORDS      = 1;   // minimum word count to accept a transcript

// ── Dynamic RMS threshold (replaces the old hardcoded SPEECH_MIN_RMS) ───────
// On each recording start we run a short calibration window to measure the
// device's ambient noise floor, then set the gate to floor × CALIB_FACTOR.
// The calibrated value is persisted in localStorage (keyed by browser deviceId)
// so subsequent sessions load the threshold instantly without waiting.
const MIN_RMS_THRESHOLD  = 1;    // absolute floor — never gate below this
const CALIB_MS           = 2000; // ambient sampling window in ms
const CALIB_FACTOR       = 2.5;  // threshold = ambient_p25 × CALIB_FACTOR
const STORAGE_KEY_PREFIX = 'pitchmd:mic-rms:';
const STORAGE_TTL_MS     = 7 * 24 * 60 * 60 * 1000; // 7 days
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
  onContinuation,
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
  const submitTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const submitStartRef       = useRef<number>(0);
  const continuationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inContinuationRef    = useRef(false);
  const activeRef        = useRef(false);   // guards against double-start
  const mimeTypeRef      = useRef('');
  // Amplitude tracking — Web Audio API analyser for background-noise gating
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const analyserRef       = useRef<AnalyserNode | null>(null);
  const dataArrayRef      = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const peakVolumeRef     = useRef<number>(0);
  const volumeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Dynamic calibration
  const dynamicThresholdRef = useRef<number>(MIN_RMS_THRESHOLD);
  const calibSamplesRef     = useRef<number[]>([]);
  const calibTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      onAutoSubmit?.();
      if (onContinuation) {
        // Keep mic running for CONTINUATION_WAIT — intercept next transcript as continuation
        inContinuationRef.current = true;
        continuationTimerRef.current = setTimeout(() => {
          inContinuationRef.current = false;
          continuationTimerRef.current = null;
          stopRecording();
        }, CONTINUATION_WAIT);
      } else {
        stopRecording();
      }
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
      if (inContinuationRef.current) {
        // Rep kept talking after auto-submit — hand off to continuation handler
        if (continuationTimerRef.current) { clearTimeout(continuationTimerRef.current); continuationTimerRef.current = null; }
        inContinuationRef.current = false;
        stopRecording();
        onContinuation?.(text);
        return;
      }
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

      // Wire up amplitude analyser so each 3-second segment can be checked
      // against a dynamic threshold before sending to the STT API.
      try {
        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
        audioCtx.createMediaStreamSource(stream).connect(analyser);
        // Sample every 80 ms — track peak for the current segment and collect
        // raw samples during the calibration window.
        volumeIntervalRef.current = setInterval(() => {
          if (!analyserRef.current || !dataArrayRef.current) return;
          analyserRef.current.getByteTimeDomainData(dataArrayRef.current);
          const sum = dataArrayRef.current.reduce((acc, v) => acc + (v - 128) ** 2, 0);
          const rms = Math.sqrt(sum / dataArrayRef.current.length);
          if (rms > peakVolumeRef.current) peakVolumeRef.current = rms;
          // Collect raw samples while calibration window is open
          if (calibTimerRef.current !== null) calibSamplesRef.current.push(rms);
        }, 80);
      } catch {
        // AudioContext unavailable (e.g. jsdom in tests) — proceed without gating
      }

      // ── Dynamic threshold calibration ──────────────────────────────────────
      // Load a saved threshold from a previous session for this device first
      // so the gate works correctly from the very first segment.
      const deviceId   = stream.getAudioTracks()[0]?.getSettings()?.deviceId ?? 'default';
      const storageKey = `${STORAGE_KEY_PREFIX}${deviceId}`;
      dynamicThresholdRef.current = MIN_RMS_THRESHOLD; // safe bootstrap default
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const saved = JSON.parse(raw) as { threshold: number; ts: number };
          if (Date.now() - saved.ts < STORAGE_TTL_MS && saved.threshold >= MIN_RMS_THRESHOLD) {
            dynamicThresholdRef.current = saved.threshold;
            console.log(`[audio-input] loaded cached RMS threshold ${saved.threshold.toFixed(1)} for device …${deviceId.slice(-6)}`);
          }
        }
      } catch { /* ignore localStorage errors */ }

      // Always run a fresh calibration in the background to keep the threshold
      // accurate (e.g. the user moved to a noisier room).
      calibSamplesRef.current = [];
      calibTimerRef.current = setTimeout(() => {
        calibTimerRef.current = null; // mark calibration complete
        const samples = [...calibSamplesRef.current];
        calibSamplesRef.current = [];
        if (samples.length === 0) return;
        samples.sort((a, b) => a - b);
        const p25      = samples[Math.floor(samples.length * 0.25)];
        const newThr   = Math.max(MIN_RMS_THRESHOLD, Math.round(p25 * CALIB_FACTOR * 10) / 10);
        dynamicThresholdRef.current = newThr;
        try {
          localStorage.setItem(storageKey, JSON.stringify({ threshold: newThr, ts: Date.now() }));
        } catch { /* ignore */ }
        console.log(`[audio-input] calibrated RMS threshold → ${newThr.toFixed(1)} (p25=${p25.toFixed(1)}, ${samples.length} samples, device …${deviceId.slice(-6)})`);
      }, CALIB_MS);

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
          // Amplitude gate — skip silent / background-noise windows
          const peak = peakVolumeRef.current;
          peakVolumeRef.current = 0; // reset for next window
          const thr = dynamicThresholdRef.current;
          if (peak < thr) {
            console.log(`[audio-input] quiet segment skipped (peak RMS ${peak.toFixed(1)} < threshold ${thr.toFixed(1)})`);
            return;
          }
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
    if (continuationTimerRef.current) { clearTimeout(continuationTimerRef.current); continuationTimerRef.current = null; }
    inContinuationRef.current = false;
    // Tear down calibration
    if (calibTimerRef.current) { clearTimeout(calibTimerRef.current); calibTimerRef.current = null; }
    calibSamplesRef.current = [];
    // Tear down amplitude tracker
    if (volumeIntervalRef.current) { clearInterval(volumeIntervalRef.current); volumeIntervalRef.current = null; }
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current  = null;
    analyserRef.current  = null;
    dataArrayRef.current = null;
    peakVolumeRef.current = 0;
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
