// ── Avatar provider abstraction ────────────────────────────────────────────
//
// PitchMD supports two interchangeable video-avatar back-ends, both driven in
// "echo" mode (we supply the exact text the avatar speaks — no provider-side
// LLM is involved). This module holds the provider-agnostic types shared by the
// UI, the provider hook, and the per-provider SDK controllers.
//
// Isomorphic: no 'use client' / browser APIs here so it can be imported from
// both client components and server route handlers.

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

/**
 * Normalize an arbitrary physician gender string to one of our two pools.
 * Matches the existing Tavus convention: anything starting with "f" → female,
 * everything else (including null/unknown) → male.
 */
export function normalizeGender(gender: string | null | undefined): Gender {
  return typeof gender === 'string' && gender.toLowerCase().startsWith('f')
    ? 'female'
    : 'male';
}

/** Pick a random identifier from the pool matching the given gender. */
export function pickFromPool(pool: PersonaConfig, gender: string | null | undefined): string {
  const arr = pool[normalizeGender(gender)];
  return arr[Math.floor(Math.random() * arr.length)];
}

export const DEFAULT_AVATAR_PROVIDER = AvatarProvider.TAVUS;

/** Type guard for validating values read from localStorage. */
export function isAvatarProvider(value: unknown): value is AvatarProvider {
  return value === AvatarProvider.TAVUS || value === AvatarProvider.ANAM;
}
