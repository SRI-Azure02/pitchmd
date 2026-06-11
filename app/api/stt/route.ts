/**
 * POST /api/stt
 *
 * Transcribes an audio blob using Groq Whisper with a pharmaceutical
 * vocabulary prompt. The prompt biases Whisper toward correct recognition
 * of brand names (Venclexta, Imbruvica, Brukinsa, etc.) from SYNTHETIC_RX.
 *
 * Model: whisper-large-v3-turbo  (~150 ms on Groq free tier)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

// Module-level brand vocabulary cache (10-min TTL)
let _vocabCache: string | null = null;
let _vocabCacheTime = 0;
const VOCAB_TTL_MS = 10 * 60 * 1000;

async function getVocabPrompt(): Promise<string> {
  const now = Date.now();
  if (_vocabCache && now - _vocabCacheTime < VOCAB_TTL_MS) return _vocabCache;
  try {
    const sf = getSnowflakeClient();
    const brands = await sf.getAllBrands();
    _vocabCache = brands.length > 0
      ? `Pharmaceutical sales training session. Drug brand names include: ${brands.join(', ')}.`
      : 'Pharmaceutical sales training session.';
    _vocabCacheTime = now;
  } catch {
    _vocabCache = _vocabCache ?? 'Pharmaceutical sales training session.';
  }
  return _vocabCache!;
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 500 });
  }

  try {
    const formData  = await request.formData();
    const audioFile = formData.get('audio') as File | null;
    if (!audioFile || audioFile.size < 100) {
      return NextResponse.json({ transcript: '' }); // silent / too short
    }

    // Determine file extension from MIME type for Groq
    const mime = audioFile.type || 'audio/webm';
    const ext  = mime.includes('mp4') ? 'mp4'
               : mime.includes('ogg') ? 'ogg'
               : mime.includes('wav') ? 'wav'
               : 'webm';

    const vocab  = await getVocabPrompt();
    const groqFd = new FormData();
    groqFd.append('file', audioFile, `audio.${ext}`);
    // whisper-large-v3 (full model) — significantly better at rare vocabulary
    // such as pharmaceutical brand names (Venclexta, Imbruvica, Brukinsa …).
    // whisper-large-v3-turbo sacrifices accuracy for speed; for this use-case
    // correct recognition of drug names matters more than latency.
    groqFd.append('model', 'whisper-large-v3');
    groqFd.append('language', 'en');
    groqFd.append('response_format', 'json');
    groqFd.append('prompt', vocab);

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqKey}` },
      body: groqFd,
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[stt] Groq error:', err.slice(0, 300));
      return NextResponse.json({ transcript: '' });
    }

    const data = await res.json();
    const transcript = (data.text ?? '').trim();
    return NextResponse.json({ transcript });

  } catch (err: any) {
    console.error('[stt] error:', err?.message);
    return NextResponse.json({ transcript: '' });
  }
}
