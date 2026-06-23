/**
 * POST /api/stt
 *
 * Transcribes an audio blob using Groq Whisper with a pharmaceutical
 * vocabulary prompt. The prompt biases Whisper toward correct recognition
 * of brand names (Venclexta, Imbruvica, Brukinsa, etc.) from SYNTHETIC_RX.
 *
 * Model: whisper-large-v3 (full model — better accuracy for rare vocabulary)
 *
 * Prompt strategy (per Gemini's recommendation):
 *   Pass each brand name alongside its generic INN — e.g.
 *   "Venclexta (venetoclax), Imbruvica (ibrutinib)".  Whisper uses the
 *   prompt string as a "frequently used words" baseline so including both
 *   forms biases its internal weights toward the correct brand spelling when
 *   it hears the acoustic signal of either name.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { getSnowflakeClient } from '@/lib/snowflake';

// ── Brand → generic INN map ──────────────────────────────────────────────────
// Pairing brand + INN in the Whisper prompt doubles the acoustic anchoring:
// if the rep says the generic name the engine still lands on the right token.
const BRAND_TO_GENERIC: Record<string, string> = {
  venclexta:  'venetoclax',
  imbruvica:  'ibrutinib',
  brukinsa:   'zanubrutinib',
  ibrance:    'palbociclib',
  calquence:  'acalabrutinib',
  jaypirca:   'pirtobrutinib',
  zydelig:    'idelalisib',
  rituxan:    'rituximab',
  gazyva:     'obinutuzumab',
  copiktra:   'duvelisib',
};

// Module-level brand vocabulary cache (10-min TTL)
let _vocabCache: string | null = null;
let _vocabCacheTime = 0;
const VOCAB_TTL_MS = 10 * 60 * 1000;

// Module-level physician names cache for Territory Intelligence STT context
let _physicianNamesCache: string | null = null;
let _physicianNamesCacheTime = 0;

async function getPhysicianNamesPrompt(): Promise<string> {
  const now = Date.now();
  if (_physicianNamesCache && now - _physicianNamesCacheTime < VOCAB_TTL_MS) return _physicianNamesCache;
  try {
    const sf = getSnowflakeClient();
    const rows = await sf.executeQuery(
      `SELECT DISTINCT PHYSICIAN_LAST_NAME FROM CORTEX_TESTING.PUBLIC.SYNTHETIC_PHYSICIAN_CHARS WHERE PHYSICIAN_LAST_NAME IS NOT NULL ORDER BY PHYSICIAN_LAST_NAME LIMIT 100`
    );
    const names = (rows as any[]).map((r: any) => r.PHYSICIAN_LAST_NAME as string).filter(Boolean);
    _physicianNamesCache = names.length > 0 ? `Physician last names in territory: ${names.join(', ')}.` : '';
    _physicianNamesCacheTime = now;
  } catch {
    _physicianNamesCache = _physicianNamesCache ?? '';
  }
  return _physicianNamesCache!;
}

async function getVocabPrompt(): Promise<string> {
  const now = Date.now();
  if (_vocabCache && now - _vocabCacheTime < VOCAB_TTL_MS) return _vocabCache;
  try {
    const sf = getSnowflakeClient();
    const brands = await sf.getAllBrands();
    if (brands.length > 0) {
      // For known drugs, append the generic INN in parentheses.
      // This biases Whisper's weights toward the correct brand spelling when
      // it hears either the brand name or the INN acoustically.
      const terms = brands.map((b) => {
        const generic = BRAND_TO_GENERIC[b.toLowerCase()];
        return generic ? `${b} (${generic})` : b;
      });
      _vocabCache =
        `Pharmaceutical sales training session. ` +
        `Drug brand names: ${terms.join(', ')}.`;
    } else {
      _vocabCache = 'Pharmaceutical sales training session.';
    }
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

    const context = formData.get('context') as string | null;
    let vocab = await getVocabPrompt();
    if (context === 'intelligence') {
      const physNames = await getPhysicianNamesPrompt();
      if (physNames) vocab = vocab + ' ' + physNames;
    }
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
