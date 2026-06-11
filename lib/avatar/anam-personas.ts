// ── Anam persona pools ──────────────────────────────────────────────────────
//
// Pre-created in Anam Lab with avatar faces (stock) and voice models attached.
// Only the UUID is needed — face + voice are resolved server-side.
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

/**
 * Randomly pick one Anam persona ID from the gender-matched pool.
 *
 * @param dbGender  PHYSICIAN_GENDER from Snowflake (primary signal)
 * @param firstName Physician first name (fallback signal when DB value is
 *                  null/empty/unrecognised — more reliable for synthetic data)
 */
export function pickAnamPersona(
  dbGender: string | null | undefined,
  firstName?: string | null,
): string {
  return pickFromPool(ANAM_PERSONAS, dbGender, firstName);
}
