import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

export interface AppSession {
  userId: string;
  username: string;
  role: 'rep' | 'admin';
}

// ── In-memory session store ──────────────────────────────────────────────────
// Survives for the lifetime of the server process. For production, swap this
// for a Redis/Snowflake-backed store keyed on sessionId.
const sessionStore = new Map<string, AppSession>();

// ── Session management ───────────────────────────────────────────────────────

export async function createSession(
  userId: string,
  username: string,
  _email: string
): Promise<string> {
  const sessionId = crypto.randomUUID();
  sessionStore.set(sessionId, { userId, username, role: 'rep' });

  const cookieStore = await cookies();
  cookieStore.set('sessionId', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });

  return sessionId;
}

// ── Password hashing (PBKDF2 via Node crypto) ────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, 100_000, 64, 'sha512')
    .toString('hex');
  return `${salt}:${hash}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [salt, expectedHash] = stored.split(':');
  if (!salt || !expectedHash) return false;
  const derivedHash = crypto
    .pbkdf2Sync(password, salt, 100_000, 64, 'sha512')
    .toString('hex');
  // Constant-time comparison to prevent timing attacks
  const a = Buffer.from(expectedHash, 'hex');
  const b = Buffer.from(derivedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Session resolver ─────────────────────────────────────────────────────────

/**
 * Feature-flagged session resolver.
 * FEATURE_AUTH=stub (default) — always returns Demo User, no cookies needed.
 * FEATURE_AUTH=real           — reads sessionId cookie and looks up the store.
 */
export async function getSessionFromRequest(
  request: NextRequest
): Promise<AppSession | null> {
  const mode = process.env.FEATURE_AUTH ?? 'stub';

  if (mode === 'stub') {
    return { userId: 'Demo User', username: 'Demo User', role: 'rep' };
  }

  const sessionId = request.cookies.get('sessionId')?.value;
  if (!sessionId) return null;

  return sessionStore.get(sessionId) ?? null;
}
