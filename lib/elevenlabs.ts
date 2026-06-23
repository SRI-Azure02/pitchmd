'use client';

/**
 * Parse [EMOTION:...] and [VOICE_MODEL:...] metadata tags emitted by the roleplay route.
 * Returns the cleaned display text plus the extracted emotion tag.
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

  const cleanText = text
    .replace(/\[EMOTION:[^\]]+\]/gi, '')
    .replace(/\[VOICE_MODEL:[^\]]+\]/gi, '')
    .replace(/\[SESSION_DURATION:[^\]]+\]/gi, '')
    .trim();

  return { emotion, voiceModel, cleanText };
}

// ─── Audio state ──────────────────────────────────────────────

let currentUtterance: SpeechSynthesisUtterance | null = null;

function cancelCurrentAudio() {
  if (currentUtterance) {
    window.speechSynthesis?.cancel();
    currentUtterance = null;
  }
}

// Average English speech rate used to estimate when to fire onNearlyDone.
const WORDS_PER_SECOND = 2.2; // ~130 wpm
const EARLY_MIC_MS = 1000;    // re-enable mic 1 s before estimated end

/**
 * Speak text via the browser Web Speech API.
 * Emotion is mapped to pitch/rate for basic expressiveness.
 * onNearlyDone fires ~1 s before the estimated end so the mic can re-enable early.
 */
export async function speakText(
  text: string,
  _voiceId: string | null | undefined,
  emotion: string,
  onNearlyDone?: () => void,
): Promise<void> {
  cancelCurrentAudio();

  const ttsText = text
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\*+/g, '')
    .trim();

  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error('Web Speech API not supported'));
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(ttsText);
    currentUtterance = utterance;

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

    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('male')) ??
      voices.find(v => v.lang.startsWith('en')) ??
      voices[0];
    if (preferred) utterance.voice = preferred;

    if (onNearlyDone) {
      const wordCount = ttsText.trim().split(/\s+/).length;
      const estimatedMs = (wordCount / (WORDS_PER_SECOND * utterance.rate)) * 1000;
      const earlyMs = Math.max(0, estimatedMs - EARLY_MIC_MS);
      const t = setTimeout(onNearlyDone, earlyMs);
      utterance.onend = () => { clearTimeout(t); currentUtterance = null; resolve(); };
    } else {
      utterance.onend = () => { currentUtterance = null; resolve(); };
    }

    utterance.onerror = (e) => {
      currentUtterance = null;
      if (e.error === 'interrupted' || e.error === 'canceled') { resolve(); return; }
      reject(new Error(e.error));
    };

    window.speechSynthesis.speak(utterance);
  });
}

export function stopCurrentAudio() {
  cancelCurrentAudio();
}
