// ── Avatar provider abstraction ────────────────────────────────────────────
//
// Isomorphic (no browser APIs) — importable from both client components and
// server route handlers.

export enum AvatarProvider {
  TAVUS = 'tavus',
  ANAM = 'anam',
}

export type Gender = 'male' | 'female';

/** Gender-keyed pools of provider-specific identifiers (replica IDs / persona IDs). */
export interface PersonaConfig {
  male: string[];
  female: string[];
}

// ── Gender detection ────────────────────────────────────────────────────────
//
// Dual-signal strategy:
//   1. PHYSICIAN_GENDER DB field (primary) — explicit match of known values
//   2. Physician first name (fallback) — reliable for American given names in
//      the synthetic dataset when the DB field is null/empty/unexpected
//
// This replaces the previous `startsWith('f')` heuristic, which silently
// defaults to 'male' for any unrecognised value (including genuinely unknown
// data), giving no way to detect when the DB field is wrong/missing.

// Top-100 American male given names (synthetic dataset uses common US names).
const MALE_NAMES = new Set([
  'james','john','robert','michael','william','david','richard','joseph',
  'thomas','charles','christopher','daniel','matthew','anthony','mark',
  'donald','steven','paul','andrew','joshua','kenneth','kevin','brian',
  'george','timothy','ronald','edward','jason','jeffrey','ryan','jacob',
  'gary','nicholas','eric','jonathan','stephen','larry','justin','scott',
  'brandon','benjamin','samuel','raymond','frank','gregory','patrick',
  'jack','dennis','peter','henry','alan','roger','harold','carl','terry',
  'gerald','keith','austin','adam','sean','ralph','carlos','wayne','arthur',
  'nathan','tyler','zachary','austin','christian','dylan','alexander',
  'ethan','evan','luke','aaron','jose','adam','travis','chad','phillip',
  'brad','brett','lance','ross','dean','glen','lloyd','ray','rick',
]);

// Top-100 American female given names.
const FEMALE_NAMES = new Set([
  'mary','patricia','jennifer','linda','barbara','elizabeth','susan',
  'jessica','sarah','karen','lisa','nancy','betty','margaret','sandra',
  'ashley','dorothy','kimberly','emily','donna','michelle','carol',
  'amanda','melissa','deborah','stephanie','rebecca','sharon','laura',
  'cynthia','kathleen','amy','angela','shirley','anna','brenda','pamela',
  'emma','nicole','helen','samantha','katherine','christine','debra',
  'rachel','carolyn','janet','catherine','maria','heather','diane',
  'julie','joyce','victoria','kelly','christina','joan','evelyn','lauren',
  'judith','olivia','alice','andrea','cheryl','denise','megan','amber',
  'ruby','grace','jean','frances','martha','gloria','beverly','irene',
  'janet','edna','janice','diane','sherry','renee','kim','tammy','stacy',
  'tracy','tiffany','amber','crystal','brittany','danielle','diana',
  'alexis','sophia','isabella','abigail','ella','chloe','madison','avery',
]);

/**
 * Normalise a raw gender string (from the DB) to our canonical Gender type.
 *
 * Snowflake PHYSICIAN_GENDER is coded as single characters: 'M' = male,
 * 'F' = female.  The DB field is the authoritative primary signal.
 * First-name inference is a fallback for rows where PHYSICIAN_GENDER is
 * absent / NULL (no override of reliable DB data).
 *
 * Strategy:
 *   1. PHYSICIAN_GENDER DB field (M/F)    → primary — most reliable signal
 *   2. firstName lookup in curated Sets   → fallback when DB value is absent
 *   3. Default: 'male'
 *
 * @param dbGender  Value of PHYSICIAN_GENDER from Snowflake ('M' | 'F' | null)
 * @param firstName Physician first name — fallback when DB value is absent
 */
export function normalizeGender(
  dbGender: string | null | undefined,
  firstName?: string | null,
): Gender {
  // ── Signal 1 (PRIMARY): PHYSICIAN_GENDER DB field ─────────────────────────
  // Snowflake returns 'M' or 'F'. We also accept the spelled-out forms to be
  // defensive against schema changes.
  if (typeof dbGender === 'string' && dbGender.trim() !== '') {
    const g = dbGender.trim().toUpperCase();
    if (g === 'F' || g === 'FEMALE' || g === 'WOMAN') {
      console.log(`[avatar] PHYSICIAN_GENDER="${dbGender}" → female`);
      return 'female';
    }
    if (g === 'M' || g === 'MALE' || g === 'MAN') {
      console.log(`[avatar] PHYSICIAN_GENDER="${dbGender}" → male`);
      return 'male';
    }
    // Unrecognised value — warn and fall through to name inference
    console.warn(`[avatar] unrecognised PHYSICIAN_GENDER value: "${dbGender}" — falling back to name`);
  }

  // ── Signal 2 (FALLBACK): first-name inference ─────────────────────────────
  // Used only when PHYSICIAN_GENDER is NULL / empty / unrecognised.
  // The curated Sets cover all common American given names in the dataset.
  if (typeof firstName === 'string' && firstName.trim() !== '') {
    const name = firstName.trim().toLowerCase();
    if (FEMALE_NAMES.has(name)) {
      console.log(`[avatar] name fallback "${firstName}" → female`);
      return 'female';
    }
    if (MALE_NAMES.has(name)) {
      console.log(`[avatar] name fallback "${firstName}" → male`);
      return 'male';
    }
    console.warn(`[avatar] name "${firstName}" not in lookup Sets — defaulting to male`);
  }

  // ── Default ───────────────────────────────────────────────────────────────
  return 'male';
}

/** Pick a random identifier from the pool matching the given gender. */
export function pickFromPool(
  pool: PersonaConfig,
  dbGender: string | null | undefined,
  firstName?: string | null,
): string {
  const gender = normalizeGender(dbGender, firstName);
  const arr = pool[gender];
  console.log(`[avatar] gender="${dbGender ?? 'null'}" firstName="${firstName ?? ''}" → pool=${gender} → ${arr.length} options`);
  return arr[Math.floor(Math.random() * arr.length)];
}

export const DEFAULT_AVATAR_PROVIDER = AvatarProvider.TAVUS;

/** Type guard for values read from localStorage. */
export function isAvatarProvider(value: unknown): value is AvatarProvider {
  return value === AvatarProvider.TAVUS || value === AvatarProvider.ANAM;
}
