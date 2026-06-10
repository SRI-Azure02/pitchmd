// ── Anam persona pools ──────────────────────────────────────────────────────
//
// These personas were pre-created in Anam Lab with avatar faces (stock) and
// voice models already attached. We only need the persona UUID — the session
// token endpoint resolves face + voice + voice-model server-side.
//
// Gender-based selection mirrors the Tavus replica logic: detect the AI agent's
// gender, then randomly pick one persona from the matching pool.
//
// Isomorphic (imported by the /api/anam/session-token route handler).

import { type PersonaConfig, pickFromPool } from './types';

export const ANAM_PERSONAS: PersonaConfig = {
  male: [
    'ffaea962-cf04-4813-9d95-75fc7fc890dd',
    'd919d871-37ff-43fe-93b8-e1f6a3c864ea',
    'a8f078e8-bc51-444a-b620-398c7c8bdbe1',
  ],
  female: [
    '45c9a72a-856b-432d-ad20-4d3455d7d6a8',
    '497a8b6d-d912-47e3-a4eb-08922e800516',
    'fae54bb7-719f-4a5d-aafb-6bb200864653',
  ],
};

/** Randomly pick one Anam persona ID from the pool matching the physician gender. */
export function pickAnamPersona(gender: string | null | undefined): string {
  return pickFromPool(ANAM_PERSONAS, gender);
}
