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

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — mirrors cookie maxAge

interface SessionEntry {
  session: AppSession;
  expiresAt: number;
}

const sessionStore = new Map<string, SessionEntry>();

/** Remove sessions that have passed their TTL. Called amortised on writes. */
function pruneExpiredSessions() {
  const now = Date.now();
  for (const [id, entry] of sessionStore.entries()) {
    if (entry.expiresAt < now) sessionStore.delete(id);
  }
}

// ── Session management ───────────────────────────────────────────────────────

export async function createSession(
  userId: string,
  username: string,
  _email: string
): Promise<string> {
  const sessionId = crypto.randomUUID();
  // Prune expired sessions ~2% of the time to avoid unbounded Map growth
  if (Math.random() < 0.02) pruneExpiredSessions();
  sessionStore.set(sessionId, {
    session: { userId, username, role: 'rep' },
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

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
  // Default to 'real' auth in all environments.
  // Set FEATURE_AUTH=stub explicitly in .env.local for local development only.
  const mode = process.env.FEATURE_AUTH ?? 'real';

  if (mode === 'stub') {
    return { userId: 'Demo User', username: 'Demo User', role: 'rep' };
  }

  const sessionId = request.cookies.get('sessionId')?.value;
  if (!sessionId) return null;

  const entry = sessionStore.get(sessionId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    sessionStore.delete(sessionId);
    return null;
  }
  return entry.session;
}
