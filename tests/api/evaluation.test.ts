import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockGetSessionFromRequest = vi.fn();
const mockGetSnowflakeClient = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockRateLimitResponse = vi.fn();
const mockAnthropicCreate = vi.fn();
const mockAnthropicStream = vi.fn();

vi.mock('@/lib/auth', () => ({
  getSessionFromRequest: mockGetSessionFromRequest,
}));

vi.mock('@/lib/snowflake', () => ({
  getSnowflakeClient: mockGetSnowflakeClient,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
  rateLimitResponse: mockRateLimitResponse,
  AI_HEAVY_LIMIT: { maxRequests: 20, windowMs: 60_000 },
}));

vi.mock('@anthropic-ai/sdk', () => {
  const mockConstructor = vi.fn(function () {
    return {
      messages: {
        create: mockAnthropicCreate,
        stream: mockAnthropicStream,
      },
    };
  });
  return { default: mockConstructor };
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures and helpers
// ─────────────────────────────────────────────────────────────────────────────

function createMockRequest(options: {
  method?: string;
  body?: Record<string, unknown>;
  searchParams?: Record<string, string>;
} = {}): NextRequest {
  const { method = 'GET', body, searchParams = {} } = options;

  const url = new URL('http://localhost:3000');
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const req = new NextRequest(url, { method });

  if (body) {
    Object.defineProperty(req, 'json', {
      value: vi.fn().mockResolvedValue(body),
      configurable: true,
    });
  }

  return req;
}

function mockSnowflakeClient() {
  return {
    queryAggregatedEvaluationByPhysician: vi.fn(),
    queryEvaluationHistory: vi.fn(),
    queryOverallPerformance: vi.fn(),
    queryPerformanceTrend: vi.fn(),
    queryPerformanceBySegment: vi.fn(),
    queryPerformanceTrendBySegment: vi.fn(),
    executeQuery: vi.fn(),
    insertEvalResult: vi.fn(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe('API Evaluation Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.ANTHROPIC_API_KEY = 'sk-test-key-123';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/evaluation/route.ts (Aggregated Evaluation)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/evaluation', () => {
    describe('authentication', () => {
      it('should return 401 when not authenticated', async () => {
        mockGetSessionFromRequest.mockResolvedValue(null);

        const { GET } = await import('@/app/api/evaluation/route');

        const req = createMockRequest({ searchParams: { physicianId: 'doc-123' } });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Unauthorized');
      });

      it('should accept valid session', async () => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });

        const mockSf = mockSnowflakeClient();
        mockSf.queryAggregatedEvaluationByPhysician.mockResolvedValue({
          PHYSICIAN_FIRST_NAME: 'Alice',
          PHYSICIAN_LAST_NAME: 'Smith',
          SESSION_COUNT: 3,
        });
        mockSf.queryEvaluationHistory.mockResolvedValue([
          { SCORE: 8.5, DATE: '2025-06-20' },
        ]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/evaluation/route');

        const req = createMockRequest({ searchParams: { physicianId: 'doc-123' } });

        const res = await GET(req as NextRequest);

        expect(res.status).toBe(200);
        expect(mockGetSessionFromRequest).toHaveBeenCalledWith(req);
      });
    });

    describe('query parameters', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });
      });

      it('should return 400 when physicianId is missing', async () => {
        const { GET } = await import('@/app/api/evaluation/route');

        const req = createMockRequest({ searchParams: {} });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toContain('physicianId');
      });

      it('should return 400 when physicianId is empty string', async () => {
        const { GET } = await import('@/app/api/evaluation/route');

        const req = createMockRequest({ searchParams: { physicianId: '' } });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toContain('physicianId');
      });

      it('should accept valid physicianId', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.queryAggregatedEvaluationByPhysician.mockResolvedValue({
          PHYSICIAN_FIRST_NAME: 'Bob',
          PHYSICIAN_LAST_NAME: 'Jones',
        });
        mockSf.queryEvaluationHistory.mockResolvedValue([]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/evaluation/route');

        const req = createMockRequest({ searchParams: { physicianId: 'phys-001' } });

        const res = await GET(req as NextRequest);

        expect(res.status).toBe(200);
        expect(mockSf.queryAggregatedEvaluationByPhysician).toHaveBeenCalledWith(
          'user-456',
          'phys-001'
        );
      });
    });

    describe('happy path', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });
      });

      it('should return evaluation data with physician name', async () => {
        const mockEvaluation = {
          PHYSICIAN_FIRST_NAME: 'Alice',
          PHYSICIAN_LAST_NAME: 'Smith',
          SESSION_COUNT: 5,
          CLINICAL_KNOWLEDGE_SCORE: 8.5,
          OBJECTION_HANDLING_SCORE: 7.2,
        };

        const mockSf = mockSnowflakeClient();
        mockSf.queryAggregatedEvaluationByPhysician.mockResolvedValue(mockEvaluation);
        mockSf.queryEvaluationHistory.mockResolvedValue([
          { SCORE: 8.5, DATE: '2025-06-20' },
          { SCORE: 7.8, DATE: '2025-06-15' },
        ]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/evaluation/route');

        const req = createMockRequest({ searchParams: { physicianId: 'doc-123' } });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.evaluation).toEqual(mockEvaluation);
        expect(data.physicianName).toBe('Alice Smith');
        expect(data.historyWithPhysician).toHaveLength(2);
        expect(data.sessionCount).toBe(5);
      });

      it('should use physicianId as name when first/last name missing', async () => {
        const mockEvaluation = {
          PHYSICIAN_FIRST_NAME: null,
          PHYSICIAN_LAST_NAME: null,
          SESSION_COUNT: 1,
        };

        const mockSf = mockSnowflakeClient();
        mockSf.queryAggregatedEvaluationByPhysician.mockResolvedValue(mockEvaluation);
        mockSf.queryEvaluationHistory.mockResolvedValue([]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/evaluation/route');

        const req = createMockRequest({ searchParams: { physicianId: 'doc-456' } });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(data.physicianName).toBe('doc-456');
      });

      it('should use first name only if last name missing', async () => {
        const mockEvaluation = {
          PHYSICIAN_FIRST_NAME: 'John',
          PHYSICIAN_LAST_NAME: null,
          SESSION_COUNT: 1,
        };

        const mockSf = mockSnowflakeClient();
        mockSf.queryAggregatedEvaluationByPhysician.mockResolvedValue(mockEvaluation);
        mockSf.queryEvaluationHistory.mockResolvedValue([]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/evaluation/route');

        const req = createMockRequest({ searchParams: { physicianId: 'doc-789' } });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(data.physicianName).toBe('doc-789');
      });

      it('should default SESSION_COUNT to 1 if null', async () => {
        const mockEvaluation = {
          PHYSICIAN_FIRST_NAME: 'Dr',
          PHYSICIAN_LAST_NAME: 'Test',
          SESSION_COUNT: null,
        };

        const mockSf = mockSnowflakeClient();
        mockSf.queryAggregatedEvaluationByPhysician.mockResolvedValue(mockEvaluation);
        mockSf.queryEvaluationHistory.mockResolvedValue([]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/evaluation/route');

        const req = createMockRequest({ searchParams: { physicianId: 'doc-001' } });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(data.sessionCount).toBe(1);
      });
    });

    describe('error handling', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });
      });

      it('should return 404 when evaluation not found', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.queryAggregatedEvaluationByPhysician.mockResolvedValue(null);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/evaluation/route');

        const req = createMockRequest({ searchParams: { physicianId: 'nonexistent' } });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(404);
        expect(data.error).toContain('No evaluation found');
      });

      it('should return 500 on Snowflake error', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.queryAggregatedEvaluationByPhysician.mockRejectedValue(
          new Error('Database connection failed')
        );

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/evaluation/route');

        const req = createMockRequest({ searchParams: { physicianId: 'doc-123' } });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBeDefined();
      });

      it('should handle Snowflake response with data property', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.queryAggregatedEvaluationByPhysician.mockRejectedValue({
          response: { data: 'API rate limit exceeded' },
          message: 'Request failed',
        });

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/evaluation/route');

        const req = createMockRequest({ searchParams: { physicianId: 'doc-123' } });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(500);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/evaluation/submit/route.ts (Evaluation with Claude)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/evaluation/submit', () => {
    describe('authentication', () => {
      it('should return 401 when not authenticated', async () => {
        mockGetSessionFromRequest.mockResolvedValue(null);

        const { POST } = await import('@/app/api/evaluation/submit/route');

        const req = createMockRequest({
          method: 'POST',
          body: { physicianId: 'doc-123', transcript: 'test transcript' },
        });

        const res = await POST(req as NextRequest);

        expect(res.status).toBe(401);
      });
    });

    describe('rate limiting', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });
      });

      it('should check rate limit per user ID', async () => {
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
        mockRateLimitResponse.mockReturnValue(new Response('Too many requests', { status: 429 }));

        const { POST } = await import('@/app/api/evaluation/submit/route');

        const req = createMockRequest({
          method: 'POST',
          body: { physicianId: 'doc-123', transcript: 'test' },
        });

        await POST(req as NextRequest);

        expect(mockCheckRateLimit).toHaveBeenCalledWith(
          'eval:user-456',
          expect.any(Object)
        );
      });

      it('should reject when rate limit exceeded', async () => {
        mockCheckRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 30_000 });
        mockRateLimitResponse.mockReturnValue(new Response('Too many', { status: 429 }));

        const { POST } = await import('@/app/api/evaluation/submit/route');

        const req = createMockRequest({
          method: 'POST',
          body: { physicianId: 'doc-123', transcript: 'test' },
        });

        const res = await POST(req as NextRequest);

        expect(res.status).toBe(429);
        expect(mockRateLimitResponse).toHaveBeenCalledWith(30_000);
      });

      it('should allow request when rate limit not exceeded', async () => {
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
        mockGetSnowflakeClient.mockReturnValue(mockSnowflakeClient());

        const { POST } = await import('@/app/api/evaluation/submit/route');

        const req = createMockRequest({
          method: 'POST',
          body: { physicianId: 'doc-123', transcript: 'test transcript' },
        });

        const res = await POST(req as NextRequest);

        expect(res.status).not.toBe(429);
      });
    });

    describe('input validation', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
      });

      it('should return 400 when physicianId missing', async () => {
        const { POST } = await import('@/app/api/evaluation/submit/route');

        const req = createMockRequest({
          method: 'POST',
          body: { transcript: 'test' },
        });

        const res = await POST(req as NextRequest);

        expect(res.status).toBe(400);
      });

      it('should return 400 when transcript missing', async () => {
        const { POST } = await import('@/app/api/evaluation/submit/route');

        const req = createMockRequest({
          method: 'POST',
          body: { physicianId: 'doc-123' },
        });

        const res = await POST(req as NextRequest);

        expect(res.status).toBe(400);
      });

      it('should return 400 when transcript is empty string', async () => {
        const { POST } = await import('@/app/api/evaluation/submit/route');

        const req = createMockRequest({
          method: 'POST',
          body: { physicianId: 'doc-123', transcript: '   ' },
        });

        const res = await POST(req as NextRequest);

        expect(res.status).toBe(400);
      });

      it('should accept valid physicianId and transcript', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.executeQuery.mockResolvedValueOnce([
          {
            PHYSICIAN_FIRST_NAME: 'John',
            PHYSICIAN_LAST_NAME: 'Doe',
            PHYSICIAN_SPECIALTY: 'Cardiology',
            PHYSICIAN_YEARS_IN_PRACTICE: 15,
            SEGMENT_NAME: 'Clinical Innovator',
          },
        ]);
        mockSf.executeQuery.mockResolvedValueOnce([
          { BRAND: 'Brand 1', PRESCRIPTIONS_WRITTEN: 100 },
          { BRAND: 'Brand 2', PRESCRIPTIONS_WRITTEN: 50 },
        ]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const mockStream = {
          [Symbol.asyncIterator]: async function* () {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"engagement_gate":"full","scores":{"clinical_knowledge":{"score":8}}}' } };
          },
        };

        mockAnthropicStream.mockReturnValue(mockStream);

        const { POST } = await import('@/app/api/evaluation/submit/route');

        const req = createMockRequest({
          method: 'POST',
          body: { physicianId: 'doc-123', transcript: 'valid transcript' },
        });

        const res = await POST(req as NextRequest);

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('text/event-stream');
      });
    });

    describe('API key validation', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
        delete process.env.ANTHROPIC_API_KEY;
      });

      it('should return 500 when ANTHROPIC_API_KEY not configured', async () => {
        const { POST } = await import('@/app/api/evaluation/submit/route');

        const req = createMockRequest({
          method: 'POST',
          body: { physicianId: 'doc-123', transcript: 'test' },
        });

        const res = await POST(req as NextRequest);

        expect(res.status).toBe(500);
      });
    });

    describe('streaming response', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
        process.env.ANTHROPIC_API_KEY = 'sk-test-key-123';
      });

      it('should return text/event-stream content-type', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.executeQuery.mockResolvedValueOnce([
          {
            PHYSICIAN_FIRST_NAME: 'John',
            PHYSICIAN_LAST_NAME: 'Doe',
            PHYSICIAN_SPECIALTY: 'Cardiology',
            PHYSICIAN_YEARS_IN_PRACTICE: 15,
            SEGMENT_NAME: 'Clinical Innovator',
          },
        ]);
        mockSf.executeQuery.mockResolvedValueOnce([
          { BRAND: 'Brand 1', PRESCRIPTIONS_WRITTEN: 100 },
        ]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const mockStream = {
          [Symbol.asyncIterator]: async function* () {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '{}' } };
          },
        };

        mockAnthropicStream.mockReturnValue(mockStream);

        const { POST } = await import('@/app/api/evaluation/submit/route');

        const req = createMockRequest({
          method: 'POST',
          body: { physicianId: 'doc-123', transcript: 'test' },
        });

        const res = await POST(req as NextRequest);

        expect(res.headers.get('Content-Type')).toBe('text/event-stream');
        expect(res.headers.get('Cache-Control')).toBe('no-cache');
        expect(res.headers.get('Connection')).toBe('keep-alive');
      });
    });

    describe('Snowflake queries', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
      });

      it('should query physician characteristics and RX data in parallel', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.executeQuery.mockResolvedValueOnce([
          {
            PHYSICIAN_FIRST_NAME: 'Alice',
            PHYSICIAN_LAST_NAME: 'Johnson',
            PHYSICIAN_SPECIALTY: 'Oncology',
            PHYSICIAN_YEARS_IN_PRACTICE: 20,
            SEGMENT_NAME: 'Patient-Centric Conservative',
          },
        ]);
        mockSf.executeQuery.mockResolvedValueOnce([
          { BRAND: 'Brand 1', PRESCRIPTIONS_WRITTEN: 150 },
          { BRAND: 'Brand 2', PRESCRIPTIONS_WRITTEN: 100 },
        ]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const mockStream = {
          [Symbol.asyncIterator]: async function* () {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '{}' } };
          },
        };

        mockAnthropicStream.mockReturnValue(mockStream);

        const { POST } = await import('@/app/api/evaluation/submit/route');

        const req = createMockRequest({
          method: 'POST',
          body: { physicianId: 'doc-456', transcript: 'test' },
        });

        await POST(req as NextRequest);

        expect(mockSf.executeQuery).toHaveBeenCalledTimes(2);
      });
    });

    describe('facial analysis handling', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
      });

      it('should accept optional facialAnalysis data', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.executeQuery.mockResolvedValueOnce([
          {
            PHYSICIAN_FIRST_NAME: 'Bob',
            PHYSICIAN_LAST_NAME: 'Smith',
            PHYSICIAN_SPECIALTY: 'Cardiology',
            PHYSICIAN_YEARS_IN_PRACTICE: 10,
            SEGMENT_NAME: 'Clinical Innovator',
          },
        ]);
        mockSf.executeQuery.mockResolvedValueOnce([
          { BRAND: 'Brand 1', PRESCRIPTIONS_WRITTEN: 100 },
        ]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const mockStream = {
          [Symbol.asyncIterator]: async function* () {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '{}' } };
          },
        };

        mockAnthropicStream.mockReturnValue(mockStream);

        const facialAnalysis = {
          confidence: 8.5,
          nervousness: 3.2,
          engagement: 7.8,
          frameCount: 150,
          summary: 'Good eye contact',
          observations: ['Confident demeanor'],
        };

        const { POST } = await import('@/app/api/evaluation/submit/route');

        const req = createMockRequest({
          method: 'POST',
          body: {
            physicianId: 'doc-123',
            transcript: 'test',
            facialAnalysis,
          },
        });

        const res = await POST(req as NextRequest);

        expect(res.status).toBe(200);
      });

      it('should handle null facialAnalysis', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.executeQuery.mockResolvedValueOnce([
          {
            PHYSICIAN_FIRST_NAME: 'Bob',
            PHYSICIAN_LAST_NAME: 'Smith',
            PHYSICIAN_SPECIALTY: 'Cardiology',
            PHYSICIAN_YEARS_IN_PRACTICE: 10,
            SEGMENT_NAME: 'Clinical Innovator',
          },
        ]);
        mockSf.executeQuery.mockResolvedValueOnce([
          { BRAND: 'Brand 1', PRESCRIPTIONS_WRITTEN: 100 },
        ]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const mockStream = {
          [Symbol.asyncIterator]: async function* () {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '{}' } };
          },
        };

        mockAnthropicStream.mockReturnValue(mockStream);

        const { POST } = await import('@/app/api/evaluation/submit/route');

        const req = createMockRequest({
          method: 'POST',
          body: {
            physicianId: 'doc-123',
            transcript: 'test',
            facialAnalysis: null,
          },
        });

        const res = await POST(req as NextRequest);

        expect(res.status).toBe(200);
      });
    });

    describe('edge cases and data handling', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });
        mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
      });

      it('should handle empty RX prescriptions', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.executeQuery.mockResolvedValueOnce([
          {
            PHYSICIAN_FIRST_NAME: 'Eve',
            PHYSICIAN_LAST_NAME: 'Evans',
            PHYSICIAN_SPECIALTY: 'Oncology',
            PHYSICIAN_YEARS_IN_PRACTICE: 5,
            SEGMENT_NAME: 'Volume-Driven Pragmatist',
          },
        ]);
        mockSf.executeQuery.mockResolvedValueOnce([]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const mockStream = {
          [Symbol.asyncIterator]: async function* () {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '{}' } };
          },
        };

        mockAnthropicStream.mockReturnValue(mockStream);

        const { POST } = await import('@/app/api/evaluation/submit/route');

        const req = createMockRequest({
          method: 'POST',
          body: { physicianId: 'doc-456', transcript: 'test' },
        });

        const res = await POST(req as NextRequest);

        expect(res.status).toBe(200);
        expect(mockSf.executeQuery).toHaveBeenCalledTimes(2);
      });

      it('should handle null or missing physician data fields', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.executeQuery.mockResolvedValueOnce([
          {
            PHYSICIAN_FIRST_NAME: null,
            PHYSICIAN_LAST_NAME: null,
            PHYSICIAN_SPECIALTY: null,
            PHYSICIAN_YEARS_IN_PRACTICE: null,
            SEGMENT_NAME: null,
          },
        ]);
        mockSf.executeQuery.mockResolvedValueOnce([]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const mockStream = {
          [Symbol.asyncIterator]: async function* () {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '{}' } };
          },
        };

        mockAnthropicStream.mockReturnValue(mockStream);

        const { POST } = await import('@/app/api/evaluation/submit/route');

        const req = createMockRequest({
          method: 'POST',
          body: { physicianId: 'doc-123', transcript: 'test' },
        });

        const res = await POST(req as NextRequest);

        expect(res.status).toBe(200);
      });

      it('should handle multiple brands in prescriptions', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.executeQuery.mockResolvedValueOnce([
          {
            PHYSICIAN_FIRST_NAME: 'Carol',
            PHYSICIAN_LAST_NAME: 'Davis',
            PHYSICIAN_SPECIALTY: 'Cardiology',
            PHYSICIAN_YEARS_IN_PRACTICE: 15,
            SEGMENT_NAME: 'Clinical Innovator',
          },
        ]);
        mockSf.executeQuery.mockResolvedValueOnce([
          { BRAND: 'Brand 1', PRESCRIPTIONS_WRITTEN: 100 },
          { BRAND: 'Brand 2', PRESCRIPTIONS_WRITTEN: 150 },
          { BRAND: 'Brand 3', PRESCRIPTIONS_WRITTEN: 50 },
        ]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const mockStream = {
          [Symbol.asyncIterator]: async function* () {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '{}' } };
          },
        };

        mockAnthropicStream.mockReturnValue(mockStream);

        const { POST } = await import('@/app/api/evaluation/submit/route');

        const req = createMockRequest({
          method: 'POST',
          body: { physicianId: 'doc-123', transcript: 'test' },
        });

        const res = await POST(req as NextRequest);

        expect(res.status).toBe(200);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/evaluation/performance/route.ts (Performance Summary)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/evaluation/performance', () => {
    describe('authentication', () => {
      it('should return 401 when not authenticated', async () => {
        mockGetSessionFromRequest.mockResolvedValue(null);

        const { GET } = await import('@/app/api/evaluation/performance/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Unauthorized');
      });

      it('should accept authenticated request', async () => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });

        const mockSf = mockSnowflakeClient();
        mockSf.queryOverallPerformance.mockResolvedValue({
          OVERALL_SCORE: 7.8,
          SESSION_COUNT: 5,
        });
        mockSf.queryPerformanceTrend.mockResolvedValue([]);
        mockSf.queryPerformanceBySegment.mockResolvedValue([]);
        mockSf.queryPerformanceTrendBySegment.mockResolvedValue([]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/evaluation/performance/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);

        expect(res.status).toBe(200);
      });
    });

    describe('performance queries', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });
      });

      it('should query all performance data in parallel', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.queryOverallPerformance.mockResolvedValue({
          OVERALL_SCORE: 7.8,
          SESSION_COUNT: 5,
        });
        mockSf.queryPerformanceTrend.mockResolvedValue([
          { DATE: '2025-06-20', SCORE: 8.2 },
        ]);
        mockSf.queryPerformanceBySegment.mockResolvedValue([
          { SEGMENT_NAME: 'Clinical Innovator', AVG_SCORE: 8.1 },
        ]);
        mockSf.queryPerformanceTrendBySegment.mockResolvedValue([]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/evaluation/performance/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(mockSf.queryOverallPerformance).toHaveBeenCalledWith('user-456');
        expect(mockSf.queryPerformanceTrend).toHaveBeenCalledWith('user-456');
        expect(mockSf.queryPerformanceBySegment).toHaveBeenCalledWith('user-456');
        expect(mockSf.queryPerformanceTrendBySegment).toHaveBeenCalledWith('user-456');

        expect(data.summary).toEqual({ OVERALL_SCORE: 7.8, SESSION_COUNT: 5 });
        expect(data.trend).toHaveLength(1);
        expect(data.segmentSummaries).toHaveLength(1);
      });

      it('should return 404 when no performance data found', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.queryOverallPerformance.mockResolvedValue(null);
        mockSf.queryPerformanceTrend.mockResolvedValue([]);
        mockSf.queryPerformanceBySegment.mockResolvedValue([]);
        mockSf.queryPerformanceTrendBySegment.mockResolvedValue([]);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/evaluation/performance/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(404);
        expect(data.error).toContain('No evaluation data found');
      });

      it('should return 500 on Snowflake error', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.queryOverallPerformance.mockRejectedValue(
          new Error('Connection timeout')
        );

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/evaluation/performance/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBeDefined();
      });
    });

    describe('response format', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });
      });

      it('should return all performance data fields', async () => {
        const mockSummary = {
          OVERALL_SCORE: 7.8,
          SESSION_COUNT: 5,
          AVG_CLINICAL: 8.1,
        };

        const mockTrend = [
          { DATE: '2025-06-20', SCORE: 8.2 },
          { DATE: '2025-06-15', SCORE: 7.5 },
        ];

        const mockSegmentSummaries = [
          { SEGMENT_NAME: 'Clinical Innovator', AVG_SCORE: 8.1, COUNT: 3 },
          { SEGMENT_NAME: 'Volume-Driven Pragmatist', AVG_SCORE: 7.2, COUNT: 2 },
        ];

        const mockSegmentTrends = [
          { SEGMENT_NAME: 'Clinical Innovator', DATE: '2025-06-20', SCORE: 8.5 },
        ];

        const mockSf = mockSnowflakeClient();
        mockSf.queryOverallPerformance.mockResolvedValue(mockSummary);
        mockSf.queryPerformanceTrend.mockResolvedValue(mockTrend);
        mockSf.queryPerformanceBySegment.mockResolvedValue(mockSegmentSummaries);
        mockSf.queryPerformanceTrendBySegment.mockResolvedValue(mockSegmentTrends);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/evaluation/performance/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(data).toEqual({
          summary: mockSummary,
          trend: mockTrend,
          segmentSummaries: mockSegmentSummaries,
          segmentTrends: mockSegmentTrends,
        });
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/evaluation/gap-analysis/route.ts (Gap Analysis)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/evaluation/gap-analysis', () => {
    describe('authentication', () => {
      it('should return 401 when not authenticated', async () => {
        mockGetSessionFromRequest.mockResolvedValue(null);

        const { POST } = await import('@/app/api/evaluation/gap-analysis/route');

        const req = createMockRequest({
          method: 'POST',
          body: { messages: [] },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Unauthorized');
      });
    });

    describe('input validation', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });
      });

      it('should return 400 when messages array missing', async () => {
        const { POST } = await import('@/app/api/evaluation/gap-analysis/route');

        const req = createMockRequest({
          method: 'POST',
          body: {},
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toContain('No messages provided');
      });

      it('should return 400 when messages array is empty', async () => {
        const { POST } = await import('@/app/api/evaluation/gap-analysis/route');

        const req = createMockRequest({
          method: 'POST',
          body: { messages: [] },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toContain('No messages provided');
      });

      it('should return 400 when no rep turns found', async () => {
        const { POST } = await import('@/app/api/evaluation/gap-analysis/route');

        const req = createMockRequest({
          method: 'POST',
          body: {
            messages: [
              { role: 'assistant', content: 'Hi', internal: false },
              { role: 'assistant', content: 'How can I help?', internal: false },
            ],
          },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toContain('No rep turns');
      });
    });

    describe('message filtering', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });

        mockAnthropicCreate.mockResolvedValue({
          content: [
            {
              type: 'text',
              text: '{"priorities": [], "overallAssessment": "test"}',
            },
          ],
        });
      });

      it('should filter out internal messages', async () => {
        const { POST } = await import('@/app/api/evaluation/gap-analysis/route');

        const req = createMockRequest({
          method: 'POST',
          body: {
            messages: [
              { role: 'user', content: 'Question?', internal: false },
              { role: 'assistant', content: 'Response', internal: false },
              { role: 'system', content: 'System', internal: true },
            ],
          },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(mockAnthropicCreate).toHaveBeenCalled();
        const prompt = mockAnthropicCreate.mock.calls[0][0].messages[0].content;
        expect(prompt).not.toContain('System');
      });

      it('should filter out __begin_roleplay__ message', async () => {
        const { POST } = await import('@/app/api/evaluation/gap-analysis/route');

        const req = createMockRequest({
          method: 'POST',
          body: {
            messages: [
              { role: 'user', content: '__begin_roleplay__', internal: false },
              { role: 'user', content: 'Real question', internal: false },
              { role: 'assistant', content: 'Response', internal: false },
            ],
          },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        const prompt = mockAnthropicCreate.mock.calls[0][0].messages[0].content;
        expect(prompt).not.toContain('__begin_roleplay__');
        expect(prompt).toContain('Real question');
      });
    });

    describe('Claude API integration', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });
      });

      it('should call Claude with proper message format', async () => {
        const mockResult = {
          priorities: [
            {
              rank: 1,
              area: 'Objection Handling',
              repSaid: 'Our product is great',
              idealSaid: 'Let me share the clinical data...',
              coaching: 'Be specific with evidence',
            },
          ],
          overallAssessment: 'Good effort but needs more data',
        };

        mockAnthropicCreate.mockResolvedValue({
          content: [
            {
              type: 'text',
              text: JSON.stringify(mockResult),
            },
          ],
        });

        const { POST } = await import('@/app/api/evaluation/gap-analysis/route');

        const req = createMockRequest({
          method: 'POST',
          body: {
            messages: [
              { role: 'user', content: 'Question?', internal: false },
              { role: 'assistant', content: 'Response', internal: false },
            ],
            physicianId: 'doc-123',
          },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.priorities).toHaveLength(1);
        expect(data.priorities[0].area).toBe('Objection Handling');
      });

      it('should use claude-haiku-4-5-20251001 model', async () => {
        mockAnthropicCreate.mockResolvedValue({
          content: [{ type: 'text', text: '{"priorities": [], "overallAssessment": "test"}' }],
        });

        const { POST } = await import('@/app/api/evaluation/gap-analysis/route');

        const req = createMockRequest({
          method: 'POST',
          body: {
            messages: [
              { role: 'user', content: 'Question', internal: false },
              { role: 'assistant', content: 'Response', internal: false },
            ],
          },
        });

        await POST(req as NextRequest);

        expect(mockAnthropicCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1500,
          })
        );
      });
    });

    describe('JSON parsing', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });
      });

      it('should extract JSON from Claude response with markdown', async () => {
        mockAnthropicCreate.mockResolvedValue({
          content: [
            {
              type: 'text',
              text: `Here's the analysis:
\`\`\`json
{"priorities": [{"rank": 1, "area": "Test", "repSaid": "x", "idealSaid": "y", "coaching": "z"}], "overallAssessment": "test"}
\`\`\``,
            },
          ],
        });

        const { POST } = await import('@/app/api/evaluation/gap-analysis/route');

        const req = createMockRequest({
          method: 'POST',
          body: {
            messages: [
              { role: 'user', content: 'Question', internal: false },
              { role: 'assistant', content: 'Response', internal: false },
            ],
          },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.priorities).toHaveLength(1);
      });

      it('should handle JSON without markdown delimiters', async () => {
        const result = {
          priorities: [
            {
              rank: 1,
              area: 'Clinical Knowledge',
              repSaid: 'Our efficacy is great',
              idealSaid: 'The TRIAL-001 showed 65% response rate vs 42% placebo',
              coaching: 'Cite specific data',
            },
          ],
          overallAssessment: 'Needs more clinical depth',
        };

        mockAnthropicCreate.mockResolvedValue({
          content: [{ type: 'text', text: JSON.stringify(result) }],
        });

        const { POST } = await import('@/app/api/evaluation/gap-analysis/route');

        const req = createMockRequest({
          method: 'POST',
          body: {
            messages: [
              { role: 'user', content: 'Question', internal: false },
              { role: 'assistant', content: 'Response', internal: false },
            ],
          },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.overallAssessment).toBe('Needs more clinical depth');
      });

      it('should return 500 when JSON parsing fails', async () => {
        mockAnthropicCreate.mockResolvedValue({
          content: [{ type: 'text', text: 'Invalid response, no JSON here' }],
        });

        const { POST } = await import('@/app/api/evaluation/gap-analysis/route');

        const req = createMockRequest({
          method: 'POST',
          body: {
            messages: [
              { role: 'user', content: 'Question', internal: false },
              { role: 'assistant', content: 'Response', internal: false },
            ],
          },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBeDefined();
      });
    });

    describe('error handling', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });
      });

      it('should handle Claude API errors', async () => {
        mockAnthropicCreate.mockRejectedValue(
          new Error('API rate limit exceeded')
        );

        const { POST } = await import('@/app/api/evaluation/gap-analysis/route');

        const req = createMockRequest({
          method: 'POST',
          body: {
            messages: [
              { role: 'user', content: 'Question', internal: false },
              { role: 'assistant', content: 'Response', internal: false },
            ],
          },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toContain('rate limit');
      });

      it('should handle non-Error exceptions from Claude', async () => {
        mockAnthropicCreate.mockRejectedValue('string error');

        const { POST } = await import('@/app/api/evaluation/gap-analysis/route');

        const req = createMockRequest({
          method: 'POST',
          body: {
            messages: [
              { role: 'user', content: 'Question', internal: false },
              { role: 'assistant', content: 'Response', internal: false },
            ],
          },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBeDefined();
      });
    });

    describe('edge cases', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-456',
          username: 'john_rep',
          email: 'john@company.com',
        });

        mockAnthropicCreate.mockResolvedValue({
          content: [
            {
              type: 'text',
              text: '{"priorities": [], "overallAssessment": "Short call"}',
            },
          ],
        });
      });

      it('should handle transcript with only one rep turn', async () => {
        const { POST } = await import('@/app/api/evaluation/gap-analysis/route');

        const req = createMockRequest({
          method: 'POST',
          body: {
            messages: [
              { role: 'user', content: 'Single question', internal: false },
            ],
          },
        });

        const res = await POST(req as NextRequest);

        expect(res.status).toBe(200);
      });

      it('should accept optional physicianId parameter', async () => {
        const { POST } = await import('@/app/api/evaluation/gap-analysis/route');

        const req = createMockRequest({
          method: 'POST',
          body: {
            messages: [
              { role: 'user', content: 'Question', internal: false },
              { role: 'assistant', content: 'Response', internal: false },
            ],
            physicianId: 'doc-123',
          },
        });

        const res = await POST(req as NextRequest);

        expect(res.status).toBe(200);
      });

      it('should build correct transcript from message array', async () => {
        const { POST } = await import('@/app/api/evaluation/gap-analysis/route');

        const req = createMockRequest({
          method: 'POST',
          body: {
            messages: [
              { role: 'user', content: 'Rep says this', internal: false },
              { role: 'assistant', content: 'Physician responds', internal: false },
              { role: 'user', content: 'Rep follows up', internal: false },
            ],
          },
        });

        await POST(req as NextRequest);

        const prompt = mockAnthropicCreate.mock.calls[0][0].messages[0].content;
        expect(prompt).toContain('REP: Rep says this');
        expect(prompt).toContain('PHYSICIAN: Physician responds');
        expect(prompt).toContain('REP: Rep follows up');
      });
    });
  });
});
