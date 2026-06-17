'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';

type SetupState =
  | 'requesting'   // waiting for getUserMedia
  | 'blocked'      // camera access granted but lens appears covered (too dark)
  | 'scanning'     // stream live, running face detection
  | 'no-face'      // stream live, no face found after N attempts
  | 'ready'        // face confirmed — ready to start
  | 'error';       // getUserMedia denied or unavailable

interface Props {
  open: boolean;
  onConfirm: (stream: MediaStream) => void;  // hands the live stream to the caller
  onSkip: () => void;                         // proceed without camera
}

// Mean pixel brightness across a canvas sample — 0 (black) to 255 (white).
function frameBrightness(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 128;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0;
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    sum += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
  }
  return sum / pixels;
}

// Capture a JPEG base64 string from a video element via an offscreen canvas.
function captureJpeg(video: HTMLVideoElement, maxW = 320): string | null {
  if (video.videoWidth === 0) return null;
  const scale = Math.min(1, maxW / video.videoWidth);
  const w = Math.round(video.videoWidth  * scale);
  const h = Math.round(video.videoHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.7).split(',')[1] ?? null;
}

// Use the browser's native FaceDetector when available (Chromium / Android).
async function nativeFaceDetect(video: HTMLVideoElement): Promise<boolean> {
  if (typeof (window as any).FaceDetector === 'undefined') return false;
  try {
    const fd = new (window as any).FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
    const faces = await fd.detect(video);
    return faces.length > 0;
  } catch {
    return false;
  }
}

// Server-side fallback: send a single frame to /api/facial-analysis and check
// whether it returns a non-trivial confidence score (Claude will score 5 when
// it sees no face, citing "poor image quality").
async function serverFaceDetect(video: HTMLVideoElement): Promise<boolean> {
  const b64 = captureJpeg(video);
  if (!b64) return false;
  try {
    const res = await fetch('/api/camera-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frame: b64 }),
    });
    if (!res.ok) return false;
    const { faceDetected } = await res.json();
    return !!faceDetected;
  } catch {
    return false;
  }
}

const BLOCKED_BRIGHTNESS = 12;   // frames darker than this = lens covered
const FACE_POLL_INTERVAL = 1200; // ms between face detection attempts
const FACE_MAX_ATTEMPTS  = 8;    // give up and show "no face" prompt after this many

export default function CameraSetupModal({ open, onConfirm, onSkip }: Props) {
  const [state, setState] = useState<SetupState>('requesting');
  const [faceAttempts, setFaceAttempts] = useState(0);
  const videoRef   = useRef<HTMLVideoElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef      = useRef(true);
  // Set to true once onConfirm is called so the unmount cleanup doesn't stop
  // tracks that have already been handed to the parent.
  const handedOffRef    = useRef(false);

  const cleanup = useCallback(() => {
    if (timerRef.current)  { clearInterval(timerRef.current);  timerRef.current = null; }
  }, []);

  const stopStream = useCallback(() => {
    cleanup();
    if (!handedOffRef.current) {
      streamRef.current?.getTracks().forEach(t => t.stop());
    }
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [cleanup]);

  // ── Start camera ────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    stopStream();
    setState('requesting');
    setFaceAttempts(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setState('scanning');
    } catch (err: any) {
      if (mountedRef.current) setState('error');
    }
  }, [stopStream]);

  // ── Face detection loop ─────────────────────────────────────────────────────
  const runFaceDetection = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;

    // 1. Brightness check — lens blocked?
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 48;
    canvas.getContext('2d')!.drawImage(video, 0, 0, 64, 48);
    const brightness = frameBrightness(canvas);
    if (brightness < BLOCKED_BRIGHTNESS) {
      if (mountedRef.current) setState('blocked');
      return;
    }

    // 2. Face detection (native → server fallback)
    let found = await nativeFaceDetect(video);
    if (!found) found = await serverFaceDetect(video);

    if (!mountedRef.current) return;

    if (found) {
      cleanup();
      setState('ready');
      return;
    }

    setFaceAttempts(prev => {
      const next = prev + 1;
      if (next >= FACE_MAX_ATTEMPTS) {
        cleanup();
        setState('no-face');
      }
      return next;
    });
  }, [cleanup]);

  // Start detection loop when state becomes 'scanning' or 'blocked' clears
  useEffect(() => {
    if (state === 'scanning') {
      timerRef.current = setInterval(runFaceDetection, FACE_POLL_INTERVAL);
      // Run immediately too
      runFaceDetection();
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [state, runFaceDetection]);

  // Mount/unmount lifecycle
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; stopStream(); };
  }, [stopStream]);

  // Open/close
  useEffect(() => {
    if (open) { startCamera(); }
    else      { stopStream(); setState('requesting'); setFaceAttempts(0); }
  }, [open, startCamera, stopStream]);

  if (!open) return null;

  const handleConfirm = () => {
    cleanup(); // stop detection loop; keep stream alive for caller
    handedOffRef.current = true; // prevent unmount cleanup from stopping tracks
    if (streamRef.current) onConfirm(streamRef.current);
  };

  const handleSkip = () => { stopStream(); onSkip(); };
  const handleRetry = () => { setState('scanning'); };

  // ── Status banner content ───────────────────────────────────────────────────
  const statusBanner = () => {
    if (state === 'requesting') return (
      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        <span>Requesting camera access…</span>
      </div>
    );
    if (state === 'error') return (
      <div className="flex items-center gap-2 text-rose-600 text-sm">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>Camera access was denied. Check your browser permissions and try again.</span>
      </div>
    );
    if (state === 'blocked') return (
      <div className="flex items-center gap-2 text-amber-600 text-sm">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>Camera lens appears covered. Remove any shutter or sticker, then try again.</span>
      </div>
    );
    if (state === 'scanning') return (
      <div className="flex items-center gap-2 text-blue-600 text-sm">
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        <span>Looking for your face… position yourself in the oval.</span>
      </div>
    );
    if (state === 'no-face') return (
      <div className="flex items-center gap-2 text-amber-600 text-sm">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>No face detected. Make sure your face is well-lit and centred in the oval.</span>
      </div>
    );
    if (state === 'ready') return (
      <div className="flex items-center gap-2 text-emerald-600 text-sm">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span>Face detected — you're all set!</span>
      </div>
    );
  };

  const isReady   = state === 'ready';
  const showVideo = state === 'scanning' || state === 'blocked' || state === 'no-face' || state === 'ready';
  const ovalColor = state === 'ready' ? '#10b981' : state === 'blocked' || state === 'no-face' ? '#f59e0b' : '#94a3b8';

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', padding: '1rem' }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col gap-4 p-6"
        style={{ maxWidth: '26rem', width: '100%' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-slate-100">
            <Camera className="w-4 h-4 text-slate-600" />
          </div>
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Camera Setup</span>
        </div>

        <p className="text-base font-semibold text-slate-900 -mt-1">Position yourself in the frame</p>

        {/* Video preview with oval guide */}
        <div
          className="relative overflow-hidden rounded-xl bg-slate-900"
          style={{ aspectRatio: '4/3' }}
        >
          {/* Live feed */}
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
            style={{ transform: 'scaleX(-1)', opacity: showVideo ? 1 : 0, transition: 'opacity 0.3s' }}
          />

          {/* Dimming vignette outside the oval */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse 52% 68% at 50% 46%, transparent 100%, rgba(0,0,0,0.55) 100%)',
            }}
          />

          {/* SVG oval guide */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 400 300"
            preserveAspectRatio="none"
          >
            <ellipse
              cx="200" cy="138" rx="108" ry="138"
              fill="none"
              stroke={ovalColor}
              strokeWidth="2.5"
              strokeDasharray={isReady ? '0' : '8 5'}
              style={{ transition: 'stroke 0.4s' }}
            />
          </svg>

          {/* Corner guide text */}
          <div
            className="absolute bottom-2 left-0 right-0 text-center text-xs font-medium pointer-events-none"
            style={{ color: 'rgba(255,255,255,0.7)', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
          >
            Centre your face · good lighting · look at the screen
          </div>

          {/* Spinner placeholder while requesting */}
          {(state === 'requesting' || state === 'error') && (
            <div className="absolute inset-0 flex items-center justify-center">
              {state === 'requesting'
                ? <Loader2 className="w-8 h-8 text-white animate-spin opacity-60" />
                : <Camera className="w-8 h-8 text-white opacity-40" />
              }
            </div>
          )}
        </div>

        {/* Status banner */}
        <div className="px-1">{statusBanner()}</div>

        {/* Actions */}
        <div className="flex gap-3 mt-1">
          {(state === 'error' || state === 'blocked' || state === 'no-face') && (
            <button
              onClick={state === 'error' ? startCamera : handleRetry}
              className="flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Try again
            </button>
          )}

          <button
            onClick={handleConfirm}
            disabled={!isReady}
            className="flex-1 h-10 rounded-lg text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
            style={{ background: isReady ? '#0f172a' : '#94a3b8', cursor: isReady ? 'pointer' : 'not-allowed' }}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Start Session
          </button>

          <button
            onClick={handleSkip}
            className="h-10 px-4 rounded-lg border border-slate-200 text-slate-500 text-sm font-medium hover:bg-slate-50"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
