import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — set up before any imports
// ─────────────────────────────────────────────────────────────────────────────

const mockCreateSession = vi.fn();
const mockHashPassword = vi.fn();
const mockVerifyPassword = vi.fn();
const mockGetSessionFromRequest = vi.fn();
const mockGetSnowflakeClient = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockRateLimitResponse = vi.fn();
const mockCookies = vi.fn();

vi.mock('@/lib/auth', () => ({
  createSession: mockCreateSession,
  hashPassword: mockHashPassword,
  verifyPassword: mockVerifyPassword,
  getSessionFromRequest: mockGetSessionFromRequest,
}));

vi.mock('@/lib/snowflake', () => ({
  getSnowflakeClient: mockGetSnowflakeClient,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
  rateLimitResponse: mockRateLimitResponse,
  LOGIN_LIMIT: { maxRequests: 10, windowMs: 900_000 },
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures and helpers
// ─────────────────────────────────────────────────────────────────────────────

function createMockRequest(
  options: {
    method?: string;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
  } = {},
): NextRequest {
  const { method = 'POST', body, headers = {}, cookies: cookieMap = {} } = options;

  // Build headers
  const finalHeaders = new Headers(headers);
  if (body && !finalHeaders.has('Content-Type')) {
    finalHeaders.set('Content-Type', 'application/json');
  }

  // Create a minimal NextRequest mock
  const req = new NextRequest(new URL('http://localhost:3000'), {
    method,
    headers: finalHeaders,
  });

  // Mock body parsing
  if (body) {
    Object.defineProperty(req, 'json', {
      value: vi.fn().mockResolvedValue(body),
      configurable: true,
    });
  }

  // Mock cookies
  Object.defineProperty(req, 'cookies', {
    value: {
      get: vi.fn((name: string) => cookieMap[name] ? { value: cookieMap[name] } : undefined),
    },
    configurable: true,
  });

  return req;
}

function createMockCookieStore(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn((name: string) => store.get(name)),
    set: vi.fn((name: string, value: string) => store.set(name, value)),
    delete: vi.fn((name: string) => store.delete(name)),
    has: vi.fn((name: string) => store.has(name)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe('API Auth Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_USERNAME = 'john_rep';
    process.env.DEMO_PASSWORD = 'password';
    process.env.SESSION_SECRET = 'x'.repeat(32);
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_USERNAME;
    delete process.env.DEMO_PASSWORD;
    delete process.env.SESSION_SECRET;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/auth/login
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      // Import the route after mocks are set up
      vi.resetModules();
      mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Demo mode: happy path
    // ─────────────────────────────────────────────────────────────────────────

    describe('demo mode', () => {
      it('should login with correct demo credentials', async () => {
        process.env.DEMO_MODE = 'true';
        mockCreateSession.mockResolvedValue('session-token-123');
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'john_rep', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.sessionId).toBe('session-token-123');
        expect(data.username).toBe('john_rep');
        expect(mockCreateSession).toHaveBeenCalledWith('john_rep', 'john_rep', 'john_rep@demo.local');
      });

      it('should login with env-configured demo credentials', async () => {
        process.env.DEMO_MODE = 'true';
        process.env.DEMO_USERNAME = 'alice_sales';
        process.env.DEMO_PASSWORD = 'secret123';
        mockCreateSession.mockResolvedValue('token-abc');

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'alice_sales', password: 'secret123' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.sessionId).toBe('token-abc');
        expect(data.username).toBe('alice_sales');
      });

      it('should fall through to default demo credentials if not set', async () => {
        process.env.DEMO_MODE = 'true';
        delete process.env.DEMO_USERNAME;
        delete process.env.DEMO_PASSWORD;
        vi.resetModules();
        mockCreateSession.mockResolvedValue('default-token');

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'john_rep', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
      });

      it('should reject wrong demo credentials', async () => {
        process.env.DEMO_MODE = 'true';
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'john_rep', password: 'wrong_password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Invalid credentials');
      });

      it('should reject wrong username in demo mode', async () => {
        process.env.DEMO_MODE = 'true';
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'unknown_user', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Invalid credentials');
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Production mode (Snowflake)
    // ─────────────────────────────────────────────────────────────────────────

    describe('production mode', () => {
      beforeEach(() => {
        process.env.DEMO_MODE = 'false';
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
      });

      it('should login with valid Snowflake credentials', async () => {
        const mockUser = {
          USER_ID: 'user-123',
          USERNAME: 'alice_smith',
          EMAIL: 'alice@company.com',
          PASSWORD_HASH: 'hashed_password',
        };

        mockGetSnowflakeClient.mockReturnValue({
          getUserByUsername: vi.fn().mockResolvedValue(mockUser),
        });

        mockVerifyPassword.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-prod-123');

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'alice_smith', password: 'correct_password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.sessionId).toBe('session-prod-123');
        expect(data.username).toBe('alice_smith');
        expect(mockVerifyPassword).toHaveBeenCalledWith('correct_password', 'hashed_password');
        expect(mockCreateSession).toHaveBeenCalledWith('user-123', 'alice_smith', 'alice@company.com');
      });

      it('should reject incorrect Snowflake password', async () => {
        const mockUser = {
          USER_ID: 'user-456',
          USERNAME: 'bob_sales',
          EMAIL: 'bob@company.com',
          PASSWORD_HASH: 'hashed_password',
        };

        mockGetSnowflakeClient.mockReturnValue({
          getUserByUsername: vi.fn().mockResolvedValue(mockUser),
        });

        mockVerifyPassword.mockResolvedValue(false);

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'bob_sales', password: 'wrong_password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Invalid credentials');
      });

      it('should reject non-existent Snowflake user', async () => {
        mockGetSnowflakeClient.mockReturnValue({
          getUserByUsername: vi.fn().mockResolvedValue(null),
        });

        mockHashPassword.mockResolvedValue('dummy_hash');

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'nonexistent_user', password: 'any_password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Invalid credentials');
        expect(mockHashPassword).toHaveBeenCalledWith('dummy_timing_equalizer');
      });

      it('should handle user with null email', async () => {
        const mockUser = {
          USER_ID: 'user-789',
          USERNAME: 'charlie_rep',
          EMAIL: null,
          PASSWORD_HASH: 'hashed_password',
        };

        mockGetSnowflakeClient.mockReturnValue({
          getUserByUsername: vi.fn().mockResolvedValue(mockUser),
        });

        mockVerifyPassword.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('session-charlie');

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'charlie_rep', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(mockCreateSession).toHaveBeenCalledWith('user-789', 'charlie_rep', '');
      });

      it('should handle Snowflake client errors gracefully', async () => {
        mockGetSnowflakeClient.mockReturnValue({
          getUserByUsername: vi.fn().mockRejectedValue(new Error('DB connection failed')),
        });

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'alice_smith', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBe('Login failed');
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Input validation
    // ─────────────────────────────────────────────────────────────────────────

    describe('input validation', () => {
      it('should reject missing username', async () => {
        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBe('Username and password are required');
      });

      it('should reject missing password', async () => {
        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'john_rep' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBe('Username and password are required');
      });

      it('should reject both missing username and password', async () => {
        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: {},
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBe('Username and password are required');
      });

      it('should reject invalid request body (non-JSON)', async () => {
        const { POST } = await import('@/app/api/auth/login/route');

        const req = new NextRequest(new URL('http://localhost:3000'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        Object.defineProperty(req, 'json', {
          value: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
          configurable: true,
        });

        Object.defineProperty(req, 'cookies', {
          value: { get: vi.fn() },
          configurable: true,
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBe('Invalid request body');
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Username validation (injection prevention)
    // ─────────────────────────────────────────────────────────────────────────

    describe('username validation', () => {
      it('should accept valid alphanumeric username', async () => {
        process.env.DEMO_MODE = 'true';
        process.env.DEMO_USERNAME = 'user123';
        process.env.DEMO_PASSWORD = 'password';
        mockCreateSession.mockResolvedValue('token-valid');

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'user123', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
      });

      it('should accept username with dots, dashes, underscores', async () => {
        process.env.DEMO_MODE = 'true';
        process.env.DEMO_USERNAME = 'user.name-123_rep';
        process.env.DEMO_PASSWORD = 'password';
        mockCreateSession.mockResolvedValue('token-valid');

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'user.name-123_rep', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
      });

      it('should reject username with spaces', async () => {
        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'user name', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Invalid credentials');
      });

      it('should reject username with special SQL characters', async () => {
        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: "user'; DROP TABLE users; --", password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Invalid credentials');
      });

      it('should reject empty username', async () => {
        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: '', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBe('Username and password are required');
      });

      it('should reject username exceeding 64 characters', async () => {
        const { POST } = await import('@/app/api/auth/login/route');
        const longUsername = 'a'.repeat(65);

        const req = createMockRequest({
          body: { username: longUsername, password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Invalid credentials');
      });

      it('should accept username exactly 64 characters', async () => {
        process.env.DEMO_MODE = 'true';
        const validUsername = 'a'.repeat(64);
        process.env.DEMO_USERNAME = validUsername;
        process.env.DEMO_PASSWORD = 'password';
        mockCreateSession.mockResolvedValue('token-long');

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: validUsername, password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
      });

      it('should reject username with unicode characters', async () => {
        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'usér_name', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Invalid credentials');
      });

      it('should reject username with @ symbol (common injection attempt)', async () => {
        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'user@example.com', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Invalid credentials');
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Rate limiting
    // ─────────────────────────────────────────────────────────────────────────

    describe('rate limiting', () => {
      it('should allow login when rate limit not exceeded', async () => {
        process.env.DEMO_MODE = 'true';
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
        mockCreateSession.mockResolvedValue('token-rl-1');

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'john_rep', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(mockCheckRateLimit).toHaveBeenCalled();
      });

      it('should reject login when rate limit exceeded', async () => {
        mockCheckRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 45_000 });
        mockRateLimitResponse.mockReturnValue(
          new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
        );

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'john_rep', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(429);
        expect(data.error).toBe('Too many requests');
        expect(mockRateLimitResponse).toHaveBeenCalledWith(45_000);
      });

      it('should rate limit by IP address', async () => {
        process.env.DEMO_MODE = 'true';
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
        mockCreateSession.mockResolvedValue('token');

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'john_rep', password: 'password' },
          headers: { 'x-forwarded-for': '203.0.113.45' },
        });

        await POST(req as NextRequest);

        expect(mockCheckRateLimit).toHaveBeenCalledWith(
          'login:203.0.113.45',
          expect.any(Object),
        );
      });

      it('should use x-real-ip header as fallback for IP', async () => {
        process.env.DEMO_MODE = 'true';
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
        mockCreateSession.mockResolvedValue('token');

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'john_rep', password: 'password' },
          headers: { 'x-real-ip': '198.51.100.23' },
        });

        await POST(req as NextRequest);

        expect(mockCheckRateLimit).toHaveBeenCalledWith(
          'login:198.51.100.23',
          expect.any(Object),
        );
      });

      it('should use unknown as fallback when no IP header available', async () => {
        process.env.DEMO_MODE = 'true';
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
        mockCreateSession.mockResolvedValue('token');

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'john_rep', password: 'password' },
          headers: {},
        });

        await POST(req as NextRequest);

        expect(mockCheckRateLimit).toHaveBeenCalledWith(
          'login:unknown',
          expect.any(Object),
        );
      });

      it('should extract first IP from x-forwarded-for list', async () => {
        process.env.DEMO_MODE = 'true';
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
        mockCreateSession.mockResolvedValue('token');

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'john_rep', password: 'password' },
          headers: { 'x-forwarded-for': '203.0.113.1, 203.0.113.2, 203.0.113.3' },
        });

        await POST(req as NextRequest);

        expect(mockCheckRateLimit).toHaveBeenCalledWith(
          'login:203.0.113.1',
          expect.any(Object),
        );
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Error handling
    // ─────────────────────────────────────────────────────────────────────────

    describe('error handling', () => {
      it('should return 500 on session creation error', async () => {
        process.env.DEMO_MODE = 'true';
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
        mockCreateSession.mockRejectedValue(new Error('Session creation failed'));

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'john_rep', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBe('Login failed');
      });

      it('should return 500 on password verification error', async () => {
        process.env.DEMO_MODE = 'false';
        const mockUser = {
          USER_ID: 'user-123',
          USERNAME: 'alice',
          EMAIL: 'alice@company.com',
          PASSWORD_HASH: 'hash',
        };

        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
        mockGetSnowflakeClient.mockReturnValue({
          getUserByUsername: vi.fn().mockResolvedValue(mockUser),
        });
        mockVerifyPassword.mockRejectedValue(new Error('Crypto failed'));

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'alice', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBe('Login failed');
      });

      it('should return 500 on hash password error during timing equalization', async () => {
        process.env.DEMO_MODE = 'false';
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
        mockGetSnowflakeClient.mockReturnValue({
          getUserByUsername: vi.fn().mockResolvedValue(null),
        });
        mockHashPassword.mockRejectedValue(new Error('Hash failed'));

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'nonexistent', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBe('Login failed');
      });

      it('should handle non-Error exceptions gracefully', async () => {
        process.env.DEMO_MODE = 'false';
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
        mockGetSnowflakeClient.mockReturnValue({
          getUserByUsername: vi.fn().mockRejectedValue('string error'),
        });

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'alice', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBe('Login failed');
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Session creation
    // ─────────────────────────────────────────────────────────────────────────

    describe('session creation', () => {
      it('should return sessionId in response', async () => {
        process.env.DEMO_MODE = 'true';
        const expectedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc123.sig';
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
        mockCreateSession.mockResolvedValue(expectedToken);

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'john_rep', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(data.sessionId).toBe(expectedToken);
      });

      it('should create session with demo user ID equal to username', async () => {
        process.env.DEMO_MODE = 'true';
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
        mockCreateSession.mockResolvedValue('token');

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'john_rep', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        await POST(req as NextRequest);

        expect(mockCreateSession).toHaveBeenCalledWith(
          'john_rep',
          'john_rep',
          'john_rep@demo.local',
        );
      });

      it('should create session with Snowflake user data', async () => {
        process.env.DEMO_MODE = 'false';
        const mockUser = {
          USER_ID: 'sf-user-001',
          USERNAME: 'alice_smith',
          EMAIL: 'alice@company.com',
          PASSWORD_HASH: 'hash',
        };

        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
        mockGetSnowflakeClient.mockReturnValue({
          getUserByUsername: vi.fn().mockResolvedValue(mockUser),
        });
        mockVerifyPassword.mockResolvedValue(true);
        mockCreateSession.mockResolvedValue('token');

        const { POST } = await import('@/app/api/auth/login/route');

        const req = createMockRequest({
          body: { username: 'alice_smith', password: 'password' },
          headers: { 'x-forwarded-for': '192.168.1.1' },
        });

        await POST(req as NextRequest);

        expect(mockCreateSession).toHaveBeenCalledWith(
          'sf-user-001',
          'alice_smith',
          'alice@company.com',
        );
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/auth/logout
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/auth/logout', () => {
    it('should delete sessionId cookie and return success', async () => {
      const mockCookieStore = createMockCookieStore({ sessionId: 'some-token' });
      mockCookies.mockResolvedValue(mockCookieStore);

      const { POST } = await import('@/app/api/auth/logout/route');

      const req = new NextRequest(new URL('http://localhost:3000'), { method: 'POST' });

      const res = await POST(req as NextRequest);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockCookieStore.delete).toHaveBeenCalledWith('sessionId');
    });

    it('should return success even if no session cookie exists', async () => {
      const mockCookieStore = createMockCookieStore({});
      mockCookies.mockResolvedValue(mockCookieStore);

      const { POST } = await import('@/app/api/auth/logout/route');

      const req = new NextRequest(new URL('http://localhost:3000'), { method: 'POST' });

      const res = await POST(req as NextRequest);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockCookieStore.delete).toHaveBeenCalledWith('sessionId');
    });

    it('should always return 200 status', async () => {
      const mockCookieStore = createMockCookieStore({ sessionId: 'token' });
      mockCookies.mockResolvedValue(mockCookieStore);

      const { POST } = await import('@/app/api/auth/logout/route');

      const req = new NextRequest(new URL('http://localhost:3000'), { method: 'POST' });

      const res = await POST(req as NextRequest);

      expect(res.status).toBe(200);
    });

    it('should have correct content-type header', async () => {
      const mockCookieStore = createMockCookieStore({ sessionId: 'token' });
      mockCookies.mockResolvedValue(mockCookieStore);

      const { POST } = await import('@/app/api/auth/logout/route');

      const req = new NextRequest(new URL('http://localhost:3000'), { method: 'POST' });

      const res = await POST(req as NextRequest);

      expect(res.headers.get('content-type')).toContain('application/json');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/auth/me
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/auth/me', () => {
    // ─────────────────────────────────────────────────────────────────────────
    // Happy path
    // ─────────────────────────────────────────────────────────────────────────

    describe('authenticated', () => {
      it('should return user info when authenticated', async () => {
        const mockSession = {
          userId: 'user-123',
          username: 'alice_smith',
          email: 'alice@company.com',
        };

        mockGetSessionFromRequest.mockResolvedValue(mockSession);

        const { GET } = await import('@/app/api/auth/me/route');

        const req = new NextRequest(new URL('http://localhost:3000'), { method: 'GET' });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.userId).toBe('user-123');
        expect(data.username).toBe('alice_smith');
        expect(data.email).toBe('alice@company.com');
      });

      it('should include role in session if available', async () => {
        const mockSession = {
          userId: 'admin-001',
          username: 'admin_user',
          email: 'admin@company.com',
          role: 'admin' as const,
        };

        mockGetSessionFromRequest.mockResolvedValue(mockSession);

        const { GET } = await import('@/app/api/auth/me/route');

        const req = new NextRequest(new URL('http://localhost:3000'), { method: 'GET' });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.userId).toBe('admin-001');
      });

      it('should handle demo user session', async () => {
        const mockSession = {
          userId: 'Demo User',
          username: 'Demo User',
          email: 'demo@demo.local',
        };

        mockGetSessionFromRequest.mockResolvedValue(mockSession);

        const { GET } = await import('@/app/api/auth/me/route');

        const req = new NextRequest(new URL('http://localhost:3000'), { method: 'GET' });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.username).toBe('Demo User');
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Unauthenticated
    // ─────────────────────────────────────────────────────────────────────────

    describe('unauthenticated', () => {
      it('should return 401 when no session', async () => {
        mockGetSessionFromRequest.mockResolvedValue(null);

        const { GET } = await import('@/app/api/auth/me/route');

        const req = new NextRequest(new URL('http://localhost:3000'), { method: 'GET' });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Unauthorized');
      });

      it('should return 401 when session is invalid', async () => {
        mockGetSessionFromRequest.mockResolvedValue(null);

        const { GET } = await import('@/app/api/auth/me/route');

        const req = new NextRequest(new URL('http://localhost:3000'), { method: 'GET' });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
      });

      it('should call getSessionFromRequest with the request', async () => {
        mockGetSessionFromRequest.mockResolvedValue(null);

        const { GET } = await import('@/app/api/auth/me/route');

        const req = new NextRequest(new URL('http://localhost:3000'), { method: 'GET' });

        await GET(req as NextRequest);

        expect(mockGetSessionFromRequest).toHaveBeenCalledWith(req);
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Session validation
    // ─────────────────────────────────────────────────────────────────────────

    describe('session validation', () => {
      it('should return only userId, username, and email in response', async () => {
        const mockSession = {
          userId: 'user-123',
          username: 'alice',
          email: 'alice@company.com',
          role: 'rep' as const,
          extra: 'should-not-appear',
        };

        mockGetSessionFromRequest.mockResolvedValue(mockSession);

        const { GET } = await import('@/app/api/auth/me/route');

        const req = new NextRequest(new URL('http://localhost:3000'), { method: 'GET' });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(Object.keys(data)).toEqual(['userId', 'username', 'email']);
        expect(data.role).toBeUndefined();
        expect(data.extra).toBeUndefined();
      });

      it('should handle partial session data gracefully', async () => {
        const mockSession = {
          userId: 'user-123',
          username: 'alice',
          email: 'alice@company.com',
        };

        mockGetSessionFromRequest.mockResolvedValue(mockSession);

        const { GET } = await import('@/app/api/auth/me/route');

        const req = new NextRequest(new URL('http://localhost:3000'), { method: 'GET' });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.userId).toBe('user-123');
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Content-type
    // ─────────────────────────────────────────────────────────────────────────

    describe('response headers', () => {
      it('should return JSON content-type on success', async () => {
        const mockSession = {
          userId: 'user-123',
          username: 'alice',
          email: 'alice@company.com',
        };

        mockGetSessionFromRequest.mockResolvedValue(mockSession);

        const { GET } = await import('@/app/api/auth/me/route');

        const req = new NextRequest(new URL('http://localhost:3000'), { method: 'GET' });

        const res = await GET(req as NextRequest);

        expect(res.headers.get('content-type')).toContain('application/json');
      });

      it('should return JSON content-type on error', async () => {
        mockGetSessionFromRequest.mockResolvedValue(null);

        const { GET } = await import('@/app/api/auth/me/route');

        const req = new NextRequest(new URL('http://localhost:3000'), { method: 'GET' });

        const res = await GET(req as NextRequest);

        expect(res.headers.get('content-type')).toContain('application/json');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Cross-route integration tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('integration scenarios', () => {
    it('should support login → /me → logout flow', async () => {
      process.env.DEMO_MODE = 'true';
      mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
      mockCreateSession.mockResolvedValue('session-token-123');

      const { POST: login } = await import('@/app/api/auth/login/route');

      const loginReq = createMockRequest({
        body: { username: 'john_rep', password: 'password' },
        headers: { 'x-forwarded-for': '192.168.1.1' },
      });

      const loginRes = await login(loginReq as NextRequest);
      const loginData = await loginRes.json();
      const sessionId = loginData.sessionId;

      // Now test /me with the session
      mockGetSessionFromRequest.mockResolvedValue({
        userId: 'john_rep',
        username: 'john_rep',
        email: 'john_rep@demo.local',
      });

      const { GET: me } = await import('@/app/api/auth/me/route');

      const meReq = new NextRequest(new URL('http://localhost:3000'), { method: 'GET' });
      const meRes = await me(meReq as NextRequest);
      const meData = await meRes.json();

      expect(meData.username).toBe('john_rep');

      // Test logout
      const mockCookieStore = createMockCookieStore({ sessionId });
      mockCookies.mockResolvedValue(mockCookieStore);

      const { POST: logout } = await import('@/app/api/auth/logout/route');

      const logoutReq = new NextRequest(new URL('http://localhost:3000'), { method: 'POST' });
      const logoutRes = await logout(logoutReq as NextRequest);
      const logoutData = await logoutRes.json();

      expect(logoutData.success).toBe(true);
      expect(mockCookieStore.delete).toHaveBeenCalledWith('sessionId');
    });
  });
});
