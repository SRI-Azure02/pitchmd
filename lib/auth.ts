import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

export interface AppSession {
  userId: string;
  username: string;
  email: string;
  role: 'rep' | 'admin';
}

const SESSION_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

// ── Signed JWT session (HMAC-SHA256, Node crypto — no extra deps) ─────────────
//
// Replaces the previous in-memory Map store.  Sessions are now fully encoded
// in a signed HttpOnly cookie so they survive serverless cold-starts, Vercel
// redeployments, and horizontal scaling without any external state store.
//
// Required env var: SESSION_SECRET — at least 32 random characters.
// Generate one with:  node -e "console.log(require('crypto').randomBytes(40).toString('hex'))"

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function signJwt(payload: object): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET env var is missing or too short (need ≥ 32 chars). ' +
      'Generate one: node -e "console.log(require(\'crypto\').randomBytes(40).toString(\'hex\'))"'
    );
  }
  const header = b64url('{"alg":"HS256","typ":"JWT"}');
  const body   = b64url(JSON.stringify(payload));
  const sig    = b64url(
    crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token: string): Record<string, unknown> | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;

  const expectedSig = b64url(
    crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest()
  );

  // Constant-time comparison to prevent timing attacks.
  // timingSafeEqual requires equal-length buffers — HMAC-SHA256 always produces
  // 32 bytes → 43 base64url chars, so lengths will match for valid tokens.
  try {
    const a = Buffer.from(sig,         'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    // base64url → base64: restore padding and standard chars
    const padded = body.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// ── Session management ───────────────────────────────────────────────────────

export async function createSession(
  userId: string,
  username: string,
  email: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = signJwt({
    userId,
    username,
    email,
    role: 'rep',
    iat: now,
    exp: now + SESSION_TTL_SEC,
  });

  const cookieStore = await cookies();
  cookieStore.set('sessionId', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_SEC,
    path: '/',
  });

  return token;
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
  stored: string,
): Promise<boolean> {
  const [salt, expectedHash] = stored.split(':');
  if (!salt || !expectedHash) return false;
  const derivedHash = crypto
    .pbkdf2Sync(password, salt, 100_000, 64, 'sha512')
    .toString('hex');
  const a = Buffer.from(expectedHash, 'hex');
  const b = Buffer.from(derivedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Session resolver ─────────────────────────────────────────────────────────

/**
 * Feature-flagged session resolver.
 * FEATURE_AUTH=stub — always returns Demo User, no cookies needed.
 * FEATURE_AUTH=real (default) — verifies the signed JWT cookie.
 */
export async function getSessionFromRequest(
  request: NextRequest,
): Promise<AppSession | null> {
  const mode = process.env.FEATURE_AUTH ?? 'real';

  if (mode === 'stub') {
    return { userId: 'Demo User', username: 'Demo User', email: 'demo@demo.local', role: 'rep' };
  }

  const token = request.cookies.get('sessionId')?.value;
  if (!token) return null;

  const payload = verifyJwt(token);
  if (!payload) return null;

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) return null;

  return {
    userId:   String(payload.userId   ?? ''),
    username: String(payload.username ?? ''),
    email:    String(payload.email    ?? ''),
    role:     (payload.role === 'admin' ? 'admin' : 'rep'),
  };
}
