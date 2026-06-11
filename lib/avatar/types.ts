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
 * Explicit DB values take priority over name inference.  If neither signal
 * is conclusive we default to 'male' (preserves existing Tavus behaviour).
 *
 * @param dbGender  Value of PHYSICIAN_GENDER from Snowflake (may be null/undefined)
 * @param firstName Physician first name — used as a fallback when dbGender is
 *                  null, empty, or an unrecognised value
 */
export function normalizeGender(
  dbGender: string | null | undefined,
  firstName?: string | null,
): Gender {
  // ── Signal 1: explicit DB gender field ───────────────────────────────────
  if (typeof dbGender === 'string' && dbGender.trim() !== '') {
    const g = dbGender.trim().toLowerCase();
    // Accept 'female', 'f', 'woman', 'w' → female
    if (g === 'female' || g === 'f' || g === 'woman' || g === 'w') return 'female';
    // Accept 'male', 'm', 'man' → male
    if (g === 'male' || g === 'm' || g === 'man') return 'male';
    // Still try startsWith as a last-resort for legacy values ('Female', 'FEMALE', etc.)
    if (g.startsWith('f')) return 'female';
    if (g.startsWith('m')) return 'male';
    // Unrecognised value — fall through to name-based detection
    console.warn(`[avatar] unrecognised PHYSICIAN_GENDER value: "${dbGender}" — falling back to name`);
  }

  // ── Signal 2: first-name inference ───────────────────────────────────────
  if (typeof firstName === 'string' && firstName.trim() !== '') {
    const name = firstName.trim().toLowerCase();
    if (FEMALE_NAMES.has(name)) return 'female';
    if (MALE_NAMES.has(name)) return 'male';
    console.warn(`[avatar] first name "${firstName}" not in gender lookup — defaulting to male`);
  }

  // ── Default: male (preserves existing Tavus behaviour) ───────────────────
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
