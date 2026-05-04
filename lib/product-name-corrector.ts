/**
 * product-name-corrector.ts
 *
 * Client-side post-processing for STT transcripts.  Fixes common speech
 * recognition errors on pharmaceutical brand names (space insertion, minor
 * phonetic drift) without any additional API call or latency.
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
 * Preserves mixed-case (e.g. "CAR-T", "iBrance") by title-casing only the
 * first character while keeping the rest as returned from the database.
 */
function canonicalForm(brand: string): string {
  if (!brand) return brand;
  return brand.charAt(0).toUpperCase() + brand.slice(1);
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
function buildPatterns(brand: string): RegExp[] {
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
    (brand) => ({
      patterns: buildPatterns(brand),
      replacement: canonicalForm(brand),
    }),
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
