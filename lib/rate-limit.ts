/**
 * In-memory sliding-window rate limiter.
 *
 * Provides per-key request counting over a rolling time window.
 * NOTE: State is process-local — does not persist across serverless cold starts
 * or across multiple server replicas.  For cross-replica enforcement, swap the
 * Map for a Redis/Upstash atomic counter (see issue #2 / #5 on the backlog).
 */

interface WindowEntry {
  timestamps: number[];
}

const store = new Map<string, WindowEntry>();

// Amortised cleanup — prune the store roughly every 60 seconds
let lastClean = Date.now();
function maybeClean() {
  const now = Date.now();
  if (now - lastClean < 60_000) return;
  lastClean = now;
  for (const [key, entry] of store.entries()) {
    if (entry.timestamps.length === 0) store.delete(key);
  }
}

export interface RateLimitConfig {
  maxRequests: number; // max requests allowed in the window
  windowMs: number;    // window length in milliseconds
}

/**
 * Check whether `key` has exceeded the rate limit.
 * `key` should encode both the resource (endpoint name) and the requester
 * identity (IP address or session user ID) to prevent cross-user interference.
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): { allowed: boolean; retryAfterMs: number } {
  maybeClean();
  const now = Date.now();
  const windowStart = now - config.windowMs;

  const entry = store.get(key) ?? { timestamps: [] };
  entry.timestamps = entry.timestamps.filter(t => t > windowStart);

  if (entry.timestamps.length >= config.maxRequests) {
    const retryAfterMs = entry.timestamps[0] + config.windowMs - now;
    store.set(key, entry);
    return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) };
  }

  entry.timestamps.push(now);
  store.set(key, entry);
  return { allowed: true, retryAfterMs: 0 };
}

/** Build a standard 429 Too Many Requests response. */
export function rateLimitResponse(retryAfterMs: number): Response {
  return new Response(
    JSON.stringify({ error: 'Too many requests. Please try again later.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.ceil(retryAfterMs / 1000)),
      },
    },
  );
}

// ── Pre-configured limits for common endpoint categories ──────────────────────

/** Login: 10 attempts per 15 minutes per IP (brute-force protection). */
export const LOGIN_LIMIT: RateLimitConfig = { maxRequests: 10, windowMs: 15 * 60_000 };

/** Expensive AI endpoints (playbook, evaluation): 20 per minute per user. */
export const AI_HEAVY_LIMIT: RateLimitConfig = { maxRequests: 20, windowMs: 60_000 };

/** Light AI endpoints (summarize, extract): 60 per minute per user. */
export const AI_LIGHT_LIMIT: RateLimitConfig = { maxRequests: 60, windowMs: 60_000 };
