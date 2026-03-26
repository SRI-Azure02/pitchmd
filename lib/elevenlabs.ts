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
}

/**
 * ✅ Feature-flagged TTS
 * FEATURE_TTS=stub | real
 */
export async function speakText(
  text: string,
  voiceId: string,
  emotion: string
): Promise<void> {
  const mode = process.env.NEXT_PUBLIC_FEATURE_TTS ?? 'stub';

  // ✅ STUB MODE — no audio, no error
  if (mode === 'stub') {
    console.info('[tts] stub mode — audio skipped');
    return;
  }

  cancelCurrentAudio();

  const settings =
    EMOTION_SETTINGS[emotion] ?? EMOTION_SETTINGS.neutral;

  // Strip markdown formatting before sending to TTS — asterisks should not
  // be spoken aloud, but the display text keeps them for rendering italics.
  const ttsText = text
    .replace(/\*([^*]+)\*/g, '$1')  // *word* → word
    .replace(/\*+/g, '')             // stray asterisks
    .trim();

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
    const msg =
      response.status === 402
        ? 'ElevenLabs quota exceeded (402)'
        : response.status === 503
        ? 'ElevenLabs API key not configured (503)'
        : `TTS request failed (${response.status})`;

    console.error('[tts] error:', msg);
    throw new Error(msg);
  }

  const audioBlob = await response.blob();
  const audioUrl = URL.createObjectURL(audioBlob);

  currentObjectUrl = audioUrl;
  const audio = new Audio(audioUrl);
  currentAudio = audio;

  audio.onended = cancelCurrentAudio;
  audio.onerror = cancelCurrentAudio;

  await audio.play();
}

export function stopCurrentAudio() {
  cancelCurrentAudio();
}