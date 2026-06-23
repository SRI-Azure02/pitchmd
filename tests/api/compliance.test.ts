import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockGetSessionFromRequest = vi.fn();
const mockGetSnowflakeClient = vi.fn();
const mockPdfToChunks = vi.fn();

vi.mock('@/lib/auth', () => ({
  getSessionFromRequest: mockGetSessionFromRequest,
}));

vi.mock('@/lib/snowflake', () => ({
  getSnowflakeClient: mockGetSnowflakeClient,
}));

vi.mock('@/lib/pdf-chunker', () => ({
  pdfToChunks: mockPdfToChunks,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures and helpers
// ─────────────────────────────────────────────────────────────────────────────

function createMockRequest(options: {
  method?: string;
  body?: Record<string, unknown>;
  searchParams?: Record<string, string>;
  formData?: Record<string, unknown>;
} = {}): NextRequest {
  const { method = 'GET', body, searchParams = {}, formData } = options;

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

  if (formData) {
    const fd = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      if (key === 'file') {
        const file = value as File;
        fd.append(key, file);
      } else {
        fd.append(key, String(value));
      }
    });
    Object.defineProperty(req, 'formData', {
      value: vi.fn().mockResolvedValue(fd),
      configurable: true,
    });
  }

  return req;
}

function mockSnowflakeClient() {
  return {
    getComplianceSessions: vi.fn(),
    getComplianceSessionTurns: vi.fn(),
    getEscalationAlerts: vi.fn(),
    acknowledgeEscalation: vi.fn(),
    getComplianceDocuments: vi.fn(),
    registerDocument: vi.fn(),
    ingestDocumentChunk: vi.fn(),
    ingestDocumentChunkNoEmbedding: vi.fn(),
    deleteDocument: vi.fn(),
    markSessionReviewed: vi.fn(),
  };
}

function createMockFile(name: string, content: string): File {
  return new File([content], name, { type: 'application/pdf' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe('API Compliance Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.COMPLIANCE_ADMIN_EMAILS = 'admin@company.com,alice_admin';
  });

  afterEach(() => {
    delete process.env.COMPLIANCE_ADMIN_EMAILS;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/compliance/is-admin
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/compliance/is-admin', () => {
    it('should return false when not authenticated', async () => {
      mockGetSessionFromRequest.mockResolvedValue(null);

      const { GET } = await import('@/app/api/compliance/is-admin/route');

      const req = createMockRequest();

      const res = await GET(req as NextRequest);
      const data = await res.json();

      expect(data.isAdmin).toBe(false);
    });

    it('should return true when email matches admin list', async () => {
      mockGetSessionFromRequest.mockResolvedValue({
        userId: 'user-123',
        username: 'john_rep',
        email: 'admin@company.com',
      });

      const { GET } = await import('@/app/api/compliance/is-admin/route');

      const req = createMockRequest();

      const res = await GET(req as NextRequest);
      const data = await res.json();

      expect(data.isAdmin).toBe(true);
    });

    it('should return true when username matches admin list', async () => {
      mockGetSessionFromRequest.mockResolvedValue({
        userId: 'user-456',
        username: 'alice_admin',
        email: 'alice@company.com',
      });

      const { GET } = await import('@/app/api/compliance/is-admin/route');

      const req = createMockRequest();

      const res = await GET(req as NextRequest);
      const data = await res.json();

      expect(data.isAdmin).toBe(true);
    });

    it('should be case-insensitive for email matching', async () => {
      mockGetSessionFromRequest.mockResolvedValue({
        userId: 'user-789',
        username: 'bob_rep',
        email: 'ADMIN@COMPANY.COM',
      });

      const { GET } = await import('@/app/api/compliance/is-admin/route');

      const req = createMockRequest();

      const res = await GET(req as NextRequest);
      const data = await res.json();

      expect(data.isAdmin).toBe(true);
    });

    it('should return false when credentials do not match admin list', async () => {
      mockGetSessionFromRequest.mockResolvedValue({
        userId: 'user-999',
        username: 'bob_rep',
        email: 'bob@company.com',
      });

      const { GET } = await import('@/app/api/compliance/is-admin/route');

      const req = createMockRequest();

      const res = await GET(req as NextRequest);
      const data = await res.json();

      expect(data.isAdmin).toBe(false);
    });

    it('should include debug info in response', async () => {
      mockGetSessionFromRequest.mockResolvedValue({
        userId: 'user-123',
        username: 'test_user',
        email: 'test@company.com',
      });

      const { GET } = await import('@/app/api/compliance/is-admin/route');

      const req = createMockRequest();

      const res = await GET(req as NextRequest);
      const data = await res.json();

      expect(data.debug).toBeDefined();
      expect(data.debug.email).toBe('test@company.com');
      expect(data.debug.username).toBe('test_user');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/compliance/sessions (List Sessions)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/compliance/sessions', () => {
    describe('authentication & authorization', () => {
      it('should return 401 when not authenticated', async () => {
        mockGetSessionFromRequest.mockResolvedValue(null);

        const { GET } = await import('@/app/api/compliance/sessions/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Unauthorized');
      });

      it('should return 403 when not admin', async () => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-123',
          username: 'john_rep',
          email: 'john@company.com',
        });

        const { GET } = await import('@/app/api/compliance/sessions/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(403);
        expect(data.error).toBe('Forbidden');
      });
    });

    describe('pagination', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'admin-001',
          username: 'alice_admin',
          email: 'admin@company.com',
        });
      });

      it('should default to page 1', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.getComplianceSessions.mockResolvedValue({
          sessions: [{ SESSION_ID: 'sess-1' }],
          total: 50,
        });

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/compliance/sessions/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(data.page).toBe(1);
        expect(mockSf.getComplianceSessions).toHaveBeenCalledWith(20, 0);
      });

      it('should calculate offset for page 2', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.getComplianceSessions.mockResolvedValue({
          sessions: [],
          total: 50,
        });

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/compliance/sessions/route');

        const req = createMockRequest({ searchParams: { page: '2' } });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(data.page).toBe(2);
        expect(mockSf.getComplianceSessions).toHaveBeenCalledWith(20, 20);
      });

      it('should clamp page to minimum 1', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.getComplianceSessions.mockResolvedValue({
          sessions: [],
          total: 50,
        });

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/compliance/sessions/route');

        const req = createMockRequest({ searchParams: { page: '0' } });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(data.page).toBe(1);
        expect(mockSf.getComplianceSessions).toHaveBeenCalledWith(20, 0);
      });

      it('should handle negative page numbers', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.getComplianceSessions.mockResolvedValue({
          sessions: [],
          total: 50,
        });

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/compliance/sessions/route');

        const req = createMockRequest({ searchParams: { page: '-5' } });

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(data.page).toBe(1);
      });
    });

    describe('response', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'admin-001',
          username: 'alice_admin',
          email: 'admin@company.com',
        });
      });

      it('should return sessions with pagination metadata', async () => {
        const mockSessions = [
          { SESSION_ID: 'sess-1', USER_ID: 'rep-001' },
          { SESSION_ID: 'sess-2', USER_ID: 'rep-002' },
        ];

        const mockSf = mockSnowflakeClient();
        mockSf.getComplianceSessions.mockResolvedValue({
          sessions: mockSessions,
          total: 42,
        });

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/compliance/sessions/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.sessions).toEqual(mockSessions);
        expect(data.total).toBe(42);
        expect(data.pageSize).toBe(20);
      });
    });

    describe('error handling', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'admin-001',
          username: 'alice_admin',
          email: 'admin@company.com',
        });
      });

      it('should return 500 on Snowflake error', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.getComplianceSessions.mockRejectedValue(
          new Error('Connection failed')
        );

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/compliance/sessions/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBeDefined();
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/compliance/sessions/[sessionId]
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/compliance/sessions/[sessionId]', () => {
    describe('authentication & authorization', () => {
      it('should return 401 when not authenticated', async () => {
        mockGetSessionFromRequest.mockResolvedValue(null);

        const { GET } = await import('@/app/api/compliance/sessions/[sessionId]/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest, {
          params: Promise.resolve({ sessionId: 'sess-123' }),
        });
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Unauthorized');
      });

      it('should return 403 when not admin', async () => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-123',
          username: 'john_rep',
          email: 'john@company.com',
        });

        const { GET } = await import('@/app/api/compliance/sessions/[sessionId]/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest, {
          params: Promise.resolve({ sessionId: 'sess-123' }),
        });
        const data = await res.json();

        expect(res.status).toBe(403);
        expect(data.error).toBe('Forbidden');
      });
    });

    describe('dynamic params', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'admin-001',
          username: 'alice_admin',
          email: 'admin@company.com',
        });
      });

      it('should fetch turns for given sessionId', async () => {
        const mockTurns = [
          { TURN_ID: 1, REP_MESSAGE: 'Question?' },
          { TURN_ID: 2, REP_MESSAGE: 'Follow-up?' },
        ];

        const mockSf = mockSnowflakeClient();
        mockSf.getComplianceSessionTurns.mockResolvedValue(mockTurns);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/compliance/sessions/[sessionId]/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest, {
          params: Promise.resolve({ sessionId: 'sess-456' }),
        });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.turns).toEqual(mockTurns);
        expect(mockSf.getComplianceSessionTurns).toHaveBeenCalledWith('sess-456');
      });
    });

    describe('error handling', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'admin-001',
          username: 'alice_admin',
          email: 'admin@company.com',
        });
      });

      it('should return 500 on Snowflake error', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.getComplianceSessionTurns.mockRejectedValue(
          new Error('Database error')
        );

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/compliance/sessions/[sessionId]/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest, {
          params: Promise.resolve({ sessionId: 'sess-789' }),
        });
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBeDefined();
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/compliance/escalations
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/compliance/escalations', () => {
    describe('authentication & authorization', () => {
      it('should return 401 when not authenticated', async () => {
        mockGetSessionFromRequest.mockResolvedValue(null);

        const { GET } = await import('@/app/api/compliance/escalations/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Unauthorized');
      });

      it('should return 403 when not admin', async () => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-123',
          username: 'john_rep',
          email: 'john@company.com',
        });

        const { GET } = await import('@/app/api/compliance/escalations/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(403);
        expect(data.error).toBe('Forbidden');
      });
    });

    describe('happy path', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'admin-001',
          username: 'alice_admin',
          email: 'admin@company.com',
        });
      });

      it('should return escalation alerts', async () => {
        const mockAlerts = [
          { PATTERN_ID: 'pat-001', RULE_CODE: 'OFF_LABEL_001', VIOLATION_COUNT: 3 },
        ];

        const mockSf = mockSnowflakeClient();
        mockSf.getEscalationAlerts.mockResolvedValue(mockAlerts);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/compliance/escalations/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.alerts).toEqual(mockAlerts);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/compliance/escalations (Acknowledge)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/compliance/escalations', () => {
    describe('authentication & authorization', () => {
      it('should return 401 when not authenticated', async () => {
        mockGetSessionFromRequest.mockResolvedValue(null);

        const { POST } = await import('@/app/api/compliance/escalations/route');

        const req = createMockRequest({
          method: 'POST',
          body: { patternId: 'pat-123' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
      });

      it('should return 403 when not admin', async () => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-123',
          username: 'john_rep',
          email: 'john@company.com',
        });

        const { POST } = await import('@/app/api/compliance/escalations/route');

        const req = createMockRequest({
          method: 'POST',
          body: { patternId: 'pat-123' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(403);
      });
    });

    describe('input validation', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'admin-001',
          username: 'alice_admin',
          email: 'admin@company.com',
        });
      });

      it('should return 400 when patternId missing', async () => {
        const { POST } = await import('@/app/api/compliance/escalations/route');

        const req = createMockRequest({
          method: 'POST',
          body: {},
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toContain('patternId');
      });
    });

    describe('happy path', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'admin-001',
          username: 'alice_admin',
          email: 'admin@company.com',
        });
      });

      it('should acknowledge escalation', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.acknowledgeEscalation.mockResolvedValue(undefined);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { POST } = await import('@/app/api/compliance/escalations/route');

        const req = createMockRequest({
          method: 'POST',
          body: { patternId: 'pat-456' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(mockSf.acknowledgeEscalation).toHaveBeenCalledWith('pat-456');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/compliance/documents
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/compliance/documents', () => {
    describe('authentication & authorization', () => {
      it('should return 401 when not authenticated', async () => {
        mockGetSessionFromRequest.mockResolvedValue(null);

        const { GET } = await import('@/app/api/compliance/documents/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
      });

      it('should return 403 when not admin', async () => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-123',
          username: 'john_rep',
          email: 'john@company.com',
        });

        const { GET } = await import('@/app/api/compliance/documents/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(403);
      });
    });

    describe('happy path', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'admin-001',
          username: 'alice_admin',
          email: 'admin@company.com',
        });
      });

      it('should return list of documents', async () => {
        const mockDocs = [
          { DOC_ID: 'doc-001', DOC_NAME: 'Venclexta PI', PRODUCT: 'venclexta' },
        ];

        const mockSf = mockSnowflakeClient();
        mockSf.getComplianceDocuments.mockResolvedValue(mockDocs);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { GET } = await import('@/app/api/compliance/documents/route');

        const req = createMockRequest();

        const res = await GET(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.documents).toEqual(mockDocs);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE /api/compliance/documents/[docId]
  // ═══════════════════════════════════════════════════════════════════════════

  describe('DELETE /api/compliance/documents/[docId]', () => {
    describe('authentication & authorization', () => {
      it('should return 401 when not authenticated', async () => {
        mockGetSessionFromRequest.mockResolvedValue(null);

        const { DELETE } = await import('@/app/api/compliance/documents/[docId]/route');

        const req = createMockRequest({ method: 'DELETE' });

        const res = await DELETE(req as NextRequest, {
          params: Promise.resolve({ docId: 'doc-123' }),
        });
        const data = await res.json();

        expect(res.status).toBe(401);
      });

      it('should return 403 when not admin', async () => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-123',
          username: 'john_rep',
          email: 'john@company.com',
        });

        const { DELETE } = await import('@/app/api/compliance/documents/[docId]/route');

        const req = createMockRequest({ method: 'DELETE' });

        const res = await DELETE(req as NextRequest, {
          params: Promise.resolve({ docId: 'doc-123' }),
        });
        const data = await res.json();

        expect(res.status).toBe(403);
      });
    });

    describe('happy path', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'admin-001',
          username: 'alice_admin',
          email: 'admin@company.com',
        });
      });

      it('should delete document', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.deleteDocument.mockResolvedValue(undefined);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { DELETE } = await import('@/app/api/compliance/documents/[docId]/route');

        const req = createMockRequest({ method: 'DELETE' });

        const res = await DELETE(req as NextRequest, {
          params: Promise.resolve({ docId: 'doc-789' }),
        });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(mockSf.deleteDocument).toHaveBeenCalledWith('doc-789');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/compliance/documents/ingest
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/compliance/documents/ingest', () => {
    describe('authentication & authorization', () => {
      it('should return 401 when not authenticated', async () => {
        mockGetSessionFromRequest.mockResolvedValue(null);

        const { POST } = await import('@/app/api/compliance/documents/ingest/route');

        const file = createMockFile('test.pdf', 'PDF content');
        const req = createMockRequest({ method: 'POST', formData: { file } });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(401);
      });

      it('should return 403 when not admin', async () => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-123',
          username: 'john_rep',
          email: 'john@company.com',
        });

        const { POST } = await import('@/app/api/compliance/documents/ingest/route');

        const file = createMockFile('test.pdf', 'PDF content');
        const req = createMockRequest({ method: 'POST', formData: { file } });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(403);
      });
    });

    describe('file validation', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'admin-001',
          username: 'alice_admin',
          email: 'admin@company.com',
        });
      });

      it('should return 400 when no file provided', async () => {
        const { POST } = await import('@/app/api/compliance/documents/ingest/route');

        const req = createMockRequest({ method: 'POST', formData: {} });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toContain('No file provided');
      });

      it('should return 400 when file is not PDF', async () => {
        const { POST } = await import('@/app/api/compliance/documents/ingest/route');

        const file = createMockFile('document.txt', 'Text content');
        const req = createMockRequest({ method: 'POST', formData: { file } });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toContain('PDF');
      });

      it('should accept case-insensitive PDF extension', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.registerDocument.mockResolvedValue('doc-001');
        mockSf.ingestDocumentChunk.mockResolvedValue(undefined);

        mockGetSnowflakeClient.mockReturnValue(mockSf);
        mockPdfToChunks.mockResolvedValue([
          {
            chunkText: 'chunk 1',
            pageNumber: 1,
            sectionLabel: 'intro',
            chunkIndex: 0,
          },
        ]);

        const { POST } = await import('@/app/api/compliance/documents/ingest/route');

        const file = createMockFile('document.PDF', 'PDF content');
        const req = createMockRequest({
          method: 'POST',
          formData: { file, product: 'venclexta', doc_type: 'pi' },
        });

        const res = await POST(req as NextRequest);

        expect(res.status).toBe(200);
      });
    });

    describe('chunk extraction & embedding', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'admin-001',
          username: 'alice_admin',
          email: 'admin@company.com',
        });
      });

      it('should return 400 when PDF has no extractable text', async () => {
        mockPdfToChunks.mockResolvedValue([]);

        const { POST } = await import('@/app/api/compliance/documents/ingest/route');

        const file = createMockFile('empty.pdf', '');
        const req = createMockRequest({
          method: 'POST',
          formData: { file, product: 'venclexta' },
        });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toContain('No text could be extracted');
      });

      it('should register document with proper metadata', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.registerDocument.mockResolvedValue('doc-new-001');
        mockSf.ingestDocumentChunk.mockResolvedValue(undefined);

        mockGetSnowflakeClient.mockReturnValue(mockSf);
        mockPdfToChunks.mockResolvedValue([
          {
            chunkText: 'chunk 1',
            pageNumber: 1,
            sectionLabel: 'section 1',
            chunkIndex: 0,
          },
        ]);

        const { POST } = await import('@/app/api/compliance/documents/ingest/route');

        const file = createMockFile('test_file.pdf', 'content');
        const req = createMockRequest({
          method: 'POST',
          formData: { file, product: 'venclexta', doc_type: 'competitor_pi' },
        });

        const res = await POST(req as NextRequest);

        expect(mockSf.registerDocument).toHaveBeenCalledWith(
          expect.objectContaining({
            docName: 'test file',
            docType: 'competitor_pi',
            product: 'venclexta',
          })
        );
      });

      it('should use default doc_type of pi if not provided', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.registerDocument.mockResolvedValue('doc-default-001');
        mockSf.ingestDocumentChunk.mockResolvedValue(undefined);

        mockGetSnowflakeClient.mockReturnValue(mockSf);
        mockPdfToChunks.mockResolvedValue([
          {
            chunkText: 'chunk 1',
            pageNumber: 1,
            sectionLabel: 'intro',
            chunkIndex: 0,
          },
        ]);

        const { POST } = await import('@/app/api/compliance/documents/ingest/route');

        const file = createMockFile('document.pdf', 'content');
        const req = createMockRequest({ method: 'POST', formData: { file } });

        const res = await POST(req as NextRequest);

        expect(mockSf.registerDocument).toHaveBeenCalledWith(
          expect.objectContaining({ docType: 'pi' })
        );
      });

      it('should probe Cortex models in order', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.registerDocument.mockResolvedValue('doc-cortex-001');

        // Simulate first model failing, second succeeding
        mockSf.ingestDocumentChunk
          .mockRejectedValueOnce(new Error('model not available'))
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined);

        mockGetSnowflakeClient.mockReturnValue(mockSf);
        mockPdfToChunks.mockResolvedValue([
          {
            chunkText: 'chunk 1',
            pageNumber: 1,
            sectionLabel: 'section',
            chunkIndex: 0,
          },
          {
            chunkText: 'chunk 2',
            pageNumber: 1,
            sectionLabel: 'section',
            chunkIndex: 1,
          },
        ]);

        const { POST } = await import('@/app/api/compliance/documents/ingest/route');

        const file = createMockFile('multi_chunk.pdf', 'content');
        const req = createMockRequest({ method: 'POST', formData: { file } });

        const res = await POST(req as NextRequest);

        expect(res.status).toBe(200);
        expect(mockSf.ingestDocumentChunk).toHaveBeenCalledTimes(3);
      });

      it('should fall back to keyword mode when all Cortex models fail', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.registerDocument.mockResolvedValue('doc-fallback-001');
        mockSf.ingestDocumentChunk.mockRejectedValue(
          new Error('Cortex unavailable')
        );
        mockSf.ingestDocumentChunkNoEmbedding.mockResolvedValue(undefined);

        mockGetSnowflakeClient.mockReturnValue(mockSf);
        mockPdfToChunks.mockResolvedValue([
          {
            chunkText: 'chunk 1',
            pageNumber: 1,
            sectionLabel: 'section',
            chunkIndex: 0,
          },
        ]);

        const { POST } = await import('@/app/api/compliance/documents/ingest/route');

        const file = createMockFile('no_cortex.pdf', 'content');
        const req = createMockRequest({ method: 'POST', formData: { file } });

        const res = await POST(req as NextRequest);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.mode).toBe('keyword');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/compliance/sessions/[sessionId]/review
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/compliance/sessions/[sessionId]/review', () => {
    describe('authentication & authorization', () => {
      it('should return 401 when not authenticated', async () => {
        mockGetSessionFromRequest.mockResolvedValue(null);

        const { POST } = await import('@/app/api/compliance/sessions/[sessionId]/review/route');

        const req = createMockRequest({ method: 'POST', body: {} });

        const res = await POST(req as NextRequest, {
          params: Promise.resolve({ sessionId: 'sess-123' }),
        });
        const data = await res.json();

        expect(res.status).toBe(401);
      });

      it('should return 403 when not admin', async () => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'user-123',
          username: 'john_rep',
          email: 'john@company.com',
        });

        const { POST } = await import('@/app/api/compliance/sessions/[sessionId]/review/route');

        const req = createMockRequest({ method: 'POST', body: {} });

        const res = await POST(req as NextRequest, {
          params: Promise.resolve({ sessionId: 'sess-123' }),
        });
        const data = await res.json();

        expect(res.status).toBe(403);
      });
    });

    describe('happy path', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'admin-001',
          username: 'alice_admin',
          email: 'admin@company.com',
        });
      });

      it('should mark session as reviewed', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.markSessionReviewed.mockResolvedValue(undefined);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { POST } = await import('@/app/api/compliance/sessions/[sessionId]/review/route');

        const req = createMockRequest({ method: 'POST', body: {} });

        const res = await POST(req as NextRequest, {
          params: Promise.resolve({ sessionId: 'sess-review-001' }),
        });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(mockSf.markSessionReviewed).toHaveBeenCalledWith(
          'sess-review-001',
          'admin@company.com'
        );
      });

      it('should use username if email not available', async () => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'admin-002',
          username: 'alice_admin',
          email: undefined,
        });

        const mockSf = mockSnowflakeClient();
        mockSf.markSessionReviewed.mockResolvedValue(undefined);

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        vi.resetModules();
        const { POST } = await import('@/app/api/compliance/sessions/[sessionId]/review/route');

        const req = createMockRequest({ method: 'POST', body: {} });

        const res = await POST(req as NextRequest, {
          params: Promise.resolve({ sessionId: 'sess-review-002' }),
        });

        expect(res.status).toBe(200);
        expect(mockSf.markSessionReviewed).toHaveBeenCalledWith(
          'sess-review-002',
          'alice_admin'
        );
      });
    });

    describe('error handling', () => {
      beforeEach(() => {
        mockGetSessionFromRequest.mockResolvedValue({
          userId: 'admin-001',
          username: 'alice_admin',
          email: 'admin@company.com',
        });
      });

      it('should return 500 on Snowflake error', async () => {
        const mockSf = mockSnowflakeClient();
        mockSf.markSessionReviewed.mockRejectedValue(
          new Error('DB error')
        );

        mockGetSnowflakeClient.mockReturnValue(mockSf);

        const { POST } = await import('@/app/api/compliance/sessions/[sessionId]/review/route');

        const req = createMockRequest({ method: 'POST', body: {} });

        const res = await POST(req as NextRequest, {
          params: Promise.resolve({ sessionId: 'sess-error' }),
        });
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBeDefined();
      });
    });
  });
});
