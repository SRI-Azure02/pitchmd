'use client';

const EMOTION_SETTINGS: Record<
  string,
  { stability: number; style: number; similarity_boost: number }
> = {
  neutral: { stability: 0.75, style: 0.1, similarity_boost: 0.75 },
  curious: { stability: 0.65, style: 0.3, similarity_boost: 0.75 },
  skeptical: { stability: 0.5, style: 0.5, similarity_boost: 0.75 },
  frustrated: { stability: 0.3, style: 0.7, similarity_boost: 0.75 },
  dismissive: { stability: 0.4, style: 0.6, similarity_boost: 0.75 },
  impressed: { stability: 0.6, style: 0.4, similarity_boost: 0.75 },
  urgent: { stability: 0.55, style: 0.45, similarity_boost: 0.75 },
};

/**
 * ✅ Parse metadata emitted by Snowflake Cortex agent
 * Emotion + voice model only appear for role-play dialogue
 */
export function parseEmotion(text: string): {
  emotion: string;
  voiceModel: string;
  cleanText: string;
} {
  const emotionMatch = text.match(/\[EMOTION:([^\]]+)\]/i);
  const voiceMatch = text.match(/\[VOICE_MODEL:([^\]]+)\]/i);

  const emotion = emotionMatch?.[1]?.toLowerCase() ?? 'neutral';
  const voiceModel = voiceMatch?.[1] ?? 'default';

  // cleanText is used for display — keep markdown (* for italic) intact
  // so the chat renderer shows physician names / emphasis correctly.
  const cleanText = text
    .replace(/\[EMOTION:[^\]]+\]/gi, '')
    .replace(/\[VOICE_MODEL:[^\]]+\]/gi, '')
    .replace(/\[SESSION_DURATION:[^\]]+\]/gi, '')
    .trim();

  return { emotion, voiceModel, cleanText };
}

// ─── Audio Queue ─────────────────────────────────────────────

let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;

function cancelCurrentAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  if (currentUtterance) {
    window.speechSynthesis?.cancel();
    currentUtterance = null;
  }
}

// ─── Browser Web Speech API fallback ─────────────────────────

function speakWithBrowser(text: string, emotion: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error('Web Speech API not supported'));
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    currentUtterance = utterance;

    // Map emotion to pitch/rate for basic expressiveness
    const emotionMap: Record<string, { rate: number; pitch: number }> = {
      neutral:    { rate: 1.0,  pitch: 1.0 },
      curious:    { rate: 1.05, pitch: 1.1 },
      skeptical:  { rate: 0.95, pitch: 0.95 },
      frustrated: { rate: 1.1,  pitch: 0.9 },
      dismissive: { rate: 0.9,  pitch: 0.85 },
      impressed:  { rate: 1.05, pitch: 1.15 },
      urgent:     { rate: 1.15, pitch: 1.05 },
    };
    const settings = emotionMap[emotion] ?? emotionMap.neutral;
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;

    // Prefer a male English voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('male'))
      ?? voices.find(v => v.lang.startsWith('en'))
      ?? voices[0];
    if (preferred) utterance.voice = preferred;

    utterance.onend = () => { currentUtterance = null; resolve(); };
    utterance.onerror = (e) => {
      currentUtterance = null;
      // "interrupted" / "canceled" are normal side-effects of stopCurrentAudio()
      // calling speechSynthesis.cancel(). Treat them as a clean end, not an error.
      if (e.error === 'interrupted' || e.error === 'canceled') { resolve(); return; }
      reject(new Error(e.error));
    };
    window.speechSynthesis.speak(utterance);
  });
}

/**
 * ✅ Feature-flagged TTS with browser fallback
 * NEXT_PUBLIC_FEATURE_TTS=stub | real
 */
export async function speakText(
  text: string,
  voiceId: string,
  emotion: string
): Promise<void> {
  const mode = process.env.NEXT_PUBLIC_FEATURE_TTS ?? 'stub';

  if (mode === 'stub') {
    console.info('[tts] stub mode — audio skipped');
    return;
  }

  cancelCurrentAudio();

  const settings = EMOTION_SETTINGS[emotion] ?? EMOTION_SETTINGS.neutral;

  const ttsText = text
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\*+/g, '')
    .trim();

  // Try ElevenLabs first
  try {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: ttsText,
        voiceId,
        stability: settings.stability,
        style: settings.style,
        similarity_boost: settings.similarity_boost,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      console.warn('[tts] ElevenLabs failed, falling back to browser TTS:', response.status, body?.detail ?? '');
      await speakWithBrowser(ttsText, emotion);
      return;
    }

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    currentObjectUrl = audioUrl;
    const audio = new Audio(audioUrl);
    currentAudio = audio;
    audio.onended = cancelCurrentAudio;
    audio.onerror = cancelCurrentAudio;
    await audio.play();

  } catch (err) {
    console.warn('[tts] ElevenLabs error, falling back to browser TTS:', err);
    await speakWithBrowser(ttsText, emotion);
  }
}

export function stopCurrentAudio() {
  cancelCurrentAudio();
}