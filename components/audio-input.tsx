'use client';

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

const SILENCE_TIMEOUT = 5000; // 5 s — gives users enough time to finish a sentence
const RING_R = 20;
const CIRCUMFERENCE = 2 * Math.PI * RING_R;

export default function AudioInput({ onTranscript, onAutoSubmit, onCountdown, disabled, userTyping }: AudioInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [supported, setSupported] = useState(false);
  const [countdownPct, setCountdownPct] = useState<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasTranscriptRef = useRef(false);
  // Synchronous guard — prevents a second SpeechRecognition instance from
  // being created before React has flushed the isRecording state update.
  const recordingActiveRef = useRef(false);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) setSupported(true);
  }, []);

  // Stop recording immediately when disabled (e.g. while message is sending)
  useEffect(() => {
    if (disabled && isRecording) {
      clearTimers();
      recognitionRef.current?.stop();
      // recordingActiveRef is cleared in onend
      setIsRecording(false);
    }
  }, [disabled]);

  // Resume recording when no longer disabled (or when a previous recording session ends).
  // Depends on both disabled and isRecording so the effect re-fires once the Web Speech API
  // onend callback has settled isRecording to false after a stop() call.
  useEffect(() => {
    if (!disabled && supported && !isRecording) {
      const t = setTimeout(() => startRecording(), 150);
      return () => clearTimeout(t);
    }
  }, [disabled, isRecording]);

  // Mute mic and cancel countdown when user starts typing
  useEffect(() => {
    if (userTyping && isRecording) {
      clearTimers();
      recognitionRef.current?.stop();
      setIsRecording(false);
    }
  }, [userTyping]);

  const clearTimers = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    silenceTimerRef.current = null;
    progressIntervalRef.current = null;
    setCountdownPct(null);
    onCountdown?.(null);
  };

  const startSilenceTimer = () => {
    clearTimers();
    if (!hasTranscriptRef.current) return;

    const start = Date.now();
    setCountdownPct(100);
    onCountdown?.(100);

    progressIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 100 - (elapsed / SILENCE_TIMEOUT) * 100);
      setCountdownPct(remaining);
      onCountdown?.(remaining);
    }, 50);

    silenceTimerRef.current = setTimeout(() => {
      clearTimers();
      recognitionRef.current?.stop();
      setIsRecording(false);
      if (onAutoSubmit) onAutoSubmit();
    }, SILENCE_TIMEOUT);
  };

  const startRecording = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    // Use the ref (not isRecording state) to prevent a second instance from being
    // created before React has flushed the previous setIsRecording(true) call.
    if (!SR || recordingActiveRef.current) return;

    recordingActiveRef.current = true;
    const recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    hasTranscriptRef.current = false;

    recognition.onresult = (event: any) => {
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript;
      }
      if (final) {
        hasTranscriptRef.current = true;
        onTranscript(final);
        startSilenceTimer();
      }
    };

    recognition.onerror = () => {
      recordingActiveRef.current = false;
      clearTimers();
      setIsRecording(false);
    };
    recognition.onend = () => {
      recordingActiveRef.current = false;
      clearTimers();
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    clearTimers();
    recognitionRef.current?.stop();
    // recordingActiveRef will be cleared by onend; no need to reset here.
    setIsRecording(false);
  };

  if (!supported) return null;

  // Button background: solid red when recording
  const buttonBg: React.CSSProperties = isRecording
    ? { background: '#ef4444', border: 'none', color: 'white' }
    : {};

  const dashOffset = countdownPct !== null
    ? CIRCUMFERENCE * (1 - countdownPct / 100)
    : CIRCUMFERENCE;

  return (
    <div className="relative shrink-0 w-9 h-9">
      <Button
        type="button"
        size="icon"
        variant={isRecording ? 'default' : 'outline'}
        onClick={isRecording ? stopRecording : startRecording}
        disabled={disabled}
        className="absolute inset-0 rounded-full"
        style={buttonBg}
        title={isRecording ? 'Stop recording' : 'Speak your message'}
      >
        <Mic className="w-4 h-4" />
      </Button>

      {/* Countdown ring — only visible during silence countdown */}
      {countdownPct !== null && (
        <svg
          className="absolute pointer-events-none"
          style={{ inset: '-4px', width: 'calc(100% + 8px)', height: 'calc(100% + 8px)' }}
          viewBox="0 0 44 44"
        >
          {/* Track */}
          <circle cx="22" cy="22" r={RING_R} fill="none" stroke="#e2e8f0" strokeWidth="2" />
          {/* Progress arc — starts at top (12 o'clock) via rotation */}
          <circle
            cx="22"
            cy="22"
            r={RING_R}
            fill="none"
            stroke="#FF6B00"
            strokeWidth="2.5"
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
