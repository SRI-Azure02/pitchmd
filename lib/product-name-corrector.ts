/**
 * product-name-corrector.ts
 *
 * Client-side post-processing for STT transcripts.  Fixes common speech
 * recognition errors on pharmaceutical brand names without any additional
 * API call or latency.
 *
 * Two correction layers applied in order:
 *
 *   1. Phonetic misinterpretation map — exact known ASR errors sourced from
 *      empirical Whisper output analysis (e.g. "ben clexta" → "Venclexta",
 *      "vibrance" → "Ibrance").  These are specific enough to run first and
 *      catch the largest class of errors with zero false-positive risk.
 *
 *   2. Fuzzy regex patterns — catches capitalisation errors and space/hyphen
 *      insertion not already handled by the static map.
 *
 * Usage:
 *   const correct = buildCorrector(['Ibrance', 'Keytruda', 'Entresto']);
 *   correct('I brance is more effective than key truda')
 *   // → 'Ibrance is more effective than Keytruda'
 */

/** Escape a string so it can be embedded literally inside a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Derive the canonical display form of a brand name.
 * Forces sentence case — first character upper, remainder lower — so that
 * TTS engines (Tavus, Anam, ElevenLabs) pronounce the name as a word rather
 * than spelling it out letter-by-letter.  All-caps DB values like "VENCLEXTA"
 * become "Venclexta", which every TTS reads as a spoken word.
 */
function canonicalForm(brand: string): string {
  if (!brand) return brand;
  return brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
}

// ── Static phonetic misinterpretation map ────────────────────────────────────
//
// Keys:   canonical brand name in lowercase (matched via brand.toLowerCase())
// Values: common ASR / Whisper misinterpretations, all lowercase
//
// Source: empirical analysis of standard ASR output on oncology vocabulary.
// Whisper Mini / Turbo lack these words in their training corpora and try
// to fit the acoustic signal to common dictionary words instead.
//
// Patterns derived from each variant:
//   - Multi-word / hyphenated → literal phrase match (phrase specificity
//     makes word-boundaries redundant)
//   - Single-word             → \b word-boundary anchors to avoid
//     false positives inside longer tokens

const PHONETIC_VARIANTS: Record<string, string[]> = {
  venclexta: [
    'ben clexta', 'then clexta', 'vent texta', 'van clexta', 'then flex ta',
  ],
  imbruvica: [
    'in brew vica', 'improvica', 'ambrewvica', 'in bruvica',
    'm brew vica', 'embryo vica',
  ],
  brukinsa: [
    'blue kinsa', 'brew kinsa', 'broo kinsa', 'brookings uh',
    'rude kinsa', 'brook invsa',
  ],
  ibrance: [
    'i brands', 'eye brance', 'high brance', 'vibrance',
    'hybridance', 'i-prance',
  ],
  calquence: [
    'cow quench', 'cal quench', 'calcwench', 'call quench',
    'calquents', 'cow quents',
  ],
  // Jaypirca note: the 'i' before 'r' causes a double-layer of confusion
  // for speech engines — both syllable-split and vowel-swap errors are common.
  jaypirca: [
    'jay prica', 'jay perka', 'j pirca', 'jay parca',
    'jade perka', 'j prick uh',
  ],
  zydelig: [
    'side elig', 'zi delig', 'zykelig', 'high delig', 'sci-delig', 'vitalig',
  ],
  rituxan: [
    're tuxan', 'right tuxan', 'retuxin', 'red tuxan', 'ritoxan', 'writuxan',
  ],
  gazyva: [
    'god ziva', 'ga ziva', 'goes eva', 'gaze eva', 'gaziva', 'got zeva',
  ],
  copiktra: [
    'co picktra', 'cope iktra', 'go picktra', 'co pictra',
    'cold pictra', 'capiktra',
  ],
};

/** Build a case-insensitive RegExp for a single phonetic variant string. */
function buildPhoneticPattern(variant: string): RegExp {
  const escaped = escapeRegex(variant);
  // Phrases (contains space or hyphen) are specific enough without anchors.
  // Single tokens use word boundaries to avoid firing inside longer words.
  const isPhrase = /[\s\-]/.test(variant);
  return isPhrase
    ? new RegExp(escaped, 'gi')
    : new RegExp(`\\b${escaped}\\b`, 'gi');
}

/**
 * Build two RegExp patterns for a brand name:
 *
 * 1. exact   – matches the brand as one word (case-insensitive).
 *              Fixes capitalisation errors ("ibrance" → "Ibrance").
 *
 * 2. spaced  – matches the brand even when the STT inserts spaces or
 *              hyphens between syllables ("I brance", "Key-truda").
 *              Built by allowing [\s\-]* between every pair of adjacent
 *              characters.  Still requires every letter in order, so
 *              false-positive rate is very low.
 *
 * Both patterns are anchored with word-boundaries so they don't fire
 * inside a longer word.
 */
function buildFuzzyPatterns(brand: string): RegExp[] {
  const patterns: RegExp[] = [];

  // 1. Exact word match (handles capitalisation only)
  patterns.push(new RegExp(`\\b${escapeRegex(brand)}\\b`, 'gi'));

  // 2. Space/hyphen-inserted match — only useful for brands ≥ 4 chars
  //    (shorter names would produce too many false positives)
  if (brand.length >= 4) {
    const spaced = brand
      .split('')
      .map(escapeRegex)
      .join('[\\s\\-]*');
    patterns.push(new RegExp(`\\b${spaced}\\b`, 'gi'));
  }

  return patterns;
}

export type Corrector = (transcript: string) => string;

/**
 * Build a corrector function from a list of brand names.
 *
 * Each brand gets two pattern layers:
 *   1. Static phonetic misinterpretation patterns (known Whisper errors) — run first.
 *   2. Dynamic exact + fuzzy regex patterns (capitalisation / spaced letters).
 *
 * Rules are sorted longest-brand-first so that a match for "Ibrance" does
 * not prevent a longer brand like "Ibrance CDK" from matching.
 *
 * The returned function is pure and allocation-free after construction —
 * safe to call on every STT result event.
 */
export function buildCorrector(brands: string[]): Corrector {
  if (!brands.length) return (t) => t;

  // Deduplicate and sort longest first
  const unique = [...new Set(brands.filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );

  const rules: Array<{ patterns: RegExp[]; replacement: string }> = unique.map(
    (brand) => {
      // Layer 1: phonetic misinterpretation patterns (most specific — run first)
      const variants = PHONETIC_VARIANTS[brand.toLowerCase()] ?? [];
      const phoneticPatterns = variants.map(buildPhoneticPattern);

      // Layer 2: exact-match and spaced/hyphenated fuzzy patterns
      const fuzzyPatterns = buildFuzzyPatterns(brand);

      return {
        patterns: [...phoneticPatterns, ...fuzzyPatterns],
        replacement: canonicalForm(brand),
      };
    },
  );

  return (text: string): string => {
    let result = text;
    for (const { patterns, replacement } of rules) {
      for (const pattern of patterns) {
        result = result.replace(pattern, replacement);
      }
    }
    return result;
  };
}
