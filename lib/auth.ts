import { NextRequest } from 'next/server';

export interface AppSession {
  userId: string;
  username: string;
  role: 'rep' | 'admin';
}

/**
 * Feature-flagged session resolver
 * FEATURE_AUTH=stub | real
 */
export async function getSessionFromRequest(
  _request: NextRequest
): Promise<AppSession | null> {
  const mode = process.env.FEATURE_AUTH ?? 'stub';

  // ✅ STUB MODE (Demo / Dev)
  if (mode === 'stub') {
    return {
      userId: 'Demo User',
      username: 'Demo User',
      role: 'rep',
    };
  }

  // ✅ REAL MODE (placeholder for future auth)
  // Example: NextAuth, Clerk, custom JWT, etc.
  // ------------------------------------------------
  // const session = await getRealSession(_request);
  // if (!session) return null;
  // return {
  //   userId: session.user.id,
  //   username: session.user.name,
  //   role: session.user.role,
  // };

  console.warn('[auth] FEATURE_AUTH=real but no provider configured');
  return null;
}