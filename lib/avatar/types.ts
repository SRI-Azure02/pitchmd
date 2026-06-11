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
 * First-name inference takes PRIORITY over the DB field because the synthetic
 * Snowflake dataset contains incorrect PHYSICIAN_GENDER values for some records
 * (e.g. Dr. John Byrd is labelled "Female").  A known first name is far more
 * reliable than a potentially-wrong DB column.
 *
 * Strategy:
 *   1. firstName lookup in curated Sets  → used when name is recognisable
 *   2. PHYSICIAN_GENDER DB field          → used when name is unknown
 *   3. Default: 'male'                    → preserves existing Tavus behaviour
 *
 * @param dbGender  Value of PHYSICIAN_GENDER from Snowflake (may be null/undefined)
 * @param firstName Physician first name — primary signal when present in lookup
 */
export function normalizeGender(
  dbGender: string | null | undefined,
  firstName?: string | null,
): Gender {
  // ── Signal 1 (PRIMARY): first-name inference ──────────────────────────────
  // The curated name Sets cover all common American given names used in the
  // synthetic dataset.  When a match is found it takes precedence over the DB
  // field, which can contain incorrect data.
  if (typeof firstName === 'string' && firstName.trim() !== '') {
    const name = firstName.trim().toLowerCase();
    if (FEMALE_NAMES.has(name)) {
      console.log(`[avatar] gender by name "${firstName}" → female`);
      return 'female';
    }
    if (MALE_NAMES.has(name)) {
      console.log(`[avatar] gender by name "${firstName}" → male`);
      return 'male';
    }
    // Name not in either Set — fall through to DB field
    console.warn(`[avatar] first name "${firstName}" not in gender lookup — trying DB field`);
  }

  // ── Signal 2 (FALLBACK): explicit DB gender field ─────────────────────────
  // Only reached when the first name is unknown / absent.
  if (typeof dbGender === 'string' && dbGender.trim() !== '') {
    const g = dbGender.trim().toLowerCase();
    if (g === 'female' || g === 'f' || g === 'woman' || g === 'w') return 'female';
    if (g === 'male'   || g === 'm' || g === 'man')                 return 'male';
    if (g.startsWith('f')) return 'female';
    if (g.startsWith('m')) return 'male';
    console.warn(`[avatar] unrecognised PHYSICIAN_GENDER value: "${dbGender}" — defaulting to male`);
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
