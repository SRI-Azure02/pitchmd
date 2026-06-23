import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkRateLimit,
  rateLimitResponse,
  RateLimitConfig,
  LOGIN_LIMIT,
  AI_HEAVY_LIMIT,
  AI_LIGHT_LIMIT,
} from '@/lib/rate-limit';

describe('rate-limit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  describe('checkRateLimit', () => {
    describe('basic functionality', () => {
      it('should allow first request', () => {
        const config: RateLimitConfig = { maxRequests: 5, windowMs: 60_000 };
        const result = checkRateLimit('test-key', config);
        expect(result.allowed).toBe(true);
        expect(result.retryAfterMs).toBe(0);
      });

      it('should allow second request within limit', () => {
        const config: RateLimitConfig = { maxRequests: 5, windowMs: 60_000 };
        checkRateLimit('test-key', config);
        const result = checkRateLimit('test-key', config);
        expect(result.allowed).toBe(true);
        expect(result.retryAfterMs).toBe(0);
      });

      it('should allow Nth request within limit', () => {
        const config: RateLimitConfig = { maxRequests: 5, windowMs: 60_000 };
        for (let i = 0; i < 5; i++) {
          const result = checkRateLimit(`test-nth-${i}`, config);
          expect(result.allowed).toBe(true);
        }
      });

      it('should block N+1 request exceeding limit', () => {
        const config: RateLimitConfig = { maxRequests: 3, windowMs: 60_000 };
        const key = 'test-block-' + Date.now();
        for (let i = 0; i < 3; i++) {
          checkRateLimit(key, config);
        }
        const result = checkRateLimit(key, config);
        expect(result.allowed).toBe(false);
        expect(result.retryAfterMs).toBeGreaterThan(0);
      });

      it('should return reasonable retryAfterMs on block', () => {
        const config: RateLimitConfig = { maxRequests: 1, windowMs: 60_000 };
        checkRateLimit('test-key', config);
        const result = checkRateLimit('test-key', config);
        expect(result.retryAfterMs).toBeGreaterThan(50_000);
        expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
      });

      it('should enforce minimum retryAfterMs of 1000ms', () => {
        const config: RateLimitConfig = { maxRequests: 1, windowMs: 100 };
        checkRateLimit('test-key', config);
        vi.advanceTimersByTime(50);
        const result = checkRateLimit('test-key', config);
        expect(result.retryAfterMs).toBeGreaterThanOrEqual(1000);
      });
    });

    describe('window expiration', () => {
      it('should reset window after TTL expires', () => {
        const config: RateLimitConfig = { maxRequests: 1, windowMs: 60_000 };
        checkRateLimit('test-key', config);
        const blockedResult = checkRateLimit('test-key', config);
        expect(blockedResult.allowed).toBe(false);

        vi.advanceTimersByTime(60_000);
        const allowedResult = checkRateLimit('test-key', config);
        expect(allowedResult.allowed).toBe(true);
      });

      it('should track time correctly across multiple windows', () => {
        const config: RateLimitConfig = { maxRequests: 2, windowMs: 30_000 };
        checkRateLimit('test-key', config);
        checkRateLimit('test-key', config);

        vi.advanceTimersByTime(15_000);
        const blocked = checkRateLimit('test-key', config);
        expect(blocked.allowed).toBe(false);

        vi.advanceTimersByTime(15_001);
        const allowed = checkRateLimit('test-key', config);
        expect(allowed.allowed).toBe(true);
      });

      it('should expire old entries after window boundary', () => {
        const config: RateLimitConfig = { maxRequests: 2, windowMs: 10_000 };
        checkRateLimit('test-key-expire', config);
        checkRateLimit('test-key-expire', config);

        vi.advanceTimersByTime(10_001);
        const result = checkRateLimit('test-key-expire', config);
        expect(result.allowed).toBe(true);
      });
    });

    describe('key isolation', () => {
      it('should not share limits between different keys', () => {
        const config: RateLimitConfig = { maxRequests: 1, windowMs: 60_000 };
        checkRateLimit('key-a', config);
        const result = checkRateLimit('key-b', config);
        expect(result.allowed).toBe(true);
      });

      it('should maintain independent counters per key', () => {
        const config: RateLimitConfig = { maxRequests: 2, windowMs: 60_000 };
        checkRateLimit('key-1', config);
        checkRateLimit('key-1', config);
        checkRateLimit('key-2', config);

        const blockKey1 = checkRateLimit('key-1', config);
        const allowKey2 = checkRateLimit('key-2', config);

        expect(blockKey1.allowed).toBe(false);
        expect(allowKey2.allowed).toBe(true);
      });

      it('should handle many concurrent keys', () => {
        const config: RateLimitConfig = { maxRequests: 1, windowMs: 60_000 };
        const baseKey = 'concurrent-key-test-';

        // First request on each key should succeed
        for (let i = 0; i < 5; i++) {
          const result = checkRateLimit(baseKey + i, config);
          expect(result.allowed).toBe(true);
        }

        // Second request on each key should fail
        for (let i = 0; i < 5; i++) {
          const result = checkRateLimit(baseKey + i, config);
          expect(result.allowed).toBe(false);
        }
      });
    });

    describe('edge cases', () => {
      it('should handle zero maxRequests', () => {
        const config: RateLimitConfig = { maxRequests: 0, windowMs: 60_000 };
        const result = checkRateLimit('test-key', config);
        expect(result.allowed).toBe(false);
      });

      it('should handle very large maxRequests', () => {
        const config: RateLimitConfig = { maxRequests: 10_000, windowMs: 60_000 };
        for (let i = 0; i < 100; i++) {
          const result = checkRateLimit('test-key', config);
          expect(result.allowed).toBe(true);
        }
      });

      it('should handle very short window', () => {
        const config: RateLimitConfig = { maxRequests: 1, windowMs: 100 };
        checkRateLimit('test-key-short', config);
        const blocked = checkRateLimit('test-key-short', config);
        expect(blocked.allowed).toBe(false);

        vi.advanceTimersByTime(150);
        const allowed = checkRateLimit('test-key-short', config);
        expect(allowed.allowed).toBe(true);
      });

      it('should handle very long window', () => {
        const config: RateLimitConfig = { maxRequests: 1, windowMs: 86_400_000 };
        checkRateLimit('test-key', config);
        const result = checkRateLimit('test-key', config);
        expect(result.allowed).toBe(false);
      });

      it('should handle empty key string', () => {
        const config: RateLimitConfig = { maxRequests: 1, windowMs: 60_000 };
        checkRateLimit('', config);
        const result = checkRateLimit('', config);
        expect(result.allowed).toBe(false);
      });

      it('should handle special characters in key', () => {
        const config: RateLimitConfig = { maxRequests: 2, windowMs: 60_000 };
        const specialKey = 'key:@#$%^&*()';
        checkRateLimit(specialKey, config);
        checkRateLimit(specialKey, config);
        const result = checkRateLimit(specialKey, config);
        expect(result.allowed).toBe(false);
      });
    });

    describe('sliding window behavior', () => {
      it('should allow new request as old ones expire', () => {
        const config: RateLimitConfig = { maxRequests: 2, windowMs: 10_000 };
        checkRateLimit('test-key-slide', config);
        checkRateLimit('test-key-slide', config);

        vi.advanceTimersByTime(5_000);
        const blocked = checkRateLimit('test-key-slide', config);
        expect(blocked.allowed).toBe(false);

        vi.advanceTimersByTime(5_100);
        const allowed = checkRateLimit('test-key-slide', config);
        expect(allowed.allowed).toBe(true);
      });

      it('should handle precise window boundary', () => {
        const config: RateLimitConfig = { maxRequests: 1, windowMs: 10_000 };
        checkRateLimit('test-key-boundary', config);

        vi.advanceTimersByTime(9_999);
        const beforeBoundary = checkRateLimit('test-key-boundary', config);
        expect(beforeBoundary.allowed).toBe(false);

        vi.advanceTimersByTime(10);
        const afterBoundary = checkRateLimit('test-key-boundary', config);
        expect(afterBoundary.allowed).toBe(true);
      });
    });

    describe('preset configurations', () => {
      it('should use LOGIN_LIMIT config correctly', () => {
        expect(LOGIN_LIMIT.maxRequests).toBe(10);
        expect(LOGIN_LIMIT.windowMs).toBe(15 * 60_000);

        for (let i = 0; i < 10; i++) {
          const result = checkRateLimit('login-key', LOGIN_LIMIT);
          expect(result.allowed).toBe(true);
        }

        const result = checkRateLimit('login-key', LOGIN_LIMIT);
        expect(result.allowed).toBe(false);
      });

      it('should use AI_HEAVY_LIMIT config correctly', () => {
        expect(AI_HEAVY_LIMIT.maxRequests).toBe(20);
        expect(AI_HEAVY_LIMIT.windowMs).toBe(60_000);

        for (let i = 0; i < 20; i++) {
          const result = checkRateLimit('ai-key', AI_HEAVY_LIMIT);
          expect(result.allowed).toBe(true);
        }

        const result = checkRateLimit('ai-key', AI_HEAVY_LIMIT);
        expect(result.allowed).toBe(false);
      });

      it('should use AI_LIGHT_LIMIT config correctly', () => {
        expect(AI_LIGHT_LIMIT.maxRequests).toBe(60);
        expect(AI_LIGHT_LIMIT.windowMs).toBe(60_000);

        for (let i = 0; i < 60; i++) {
          checkRateLimit('light-key', AI_LIGHT_LIMIT);
        }

        const result = checkRateLimit('light-key', AI_LIGHT_LIMIT);
        expect(result.allowed).toBe(false);
      });
    });

    describe('concurrent behavior', () => {
      it('should handle burst of requests', () => {
        const config: RateLimitConfig = { maxRequests: 5, windowMs: 60_000 };
        const results = [];

        for (let i = 0; i < 10; i++) {
          results.push(checkRateLimit('burst-key', config));
        }

        expect(results.slice(0, 5).every(r => r.allowed)).toBe(true);
        expect(results.slice(5).every(r => !r.allowed)).toBe(true);
      });

      it('should maintain state across multiple checks', () => {
        const config: RateLimitConfig = { maxRequests: 3, windowMs: 60_000 };

        checkRateLimit('persistent-key', config);
        vi.advanceTimersByTime(1000);
        checkRateLimit('persistent-key', config);
        vi.advanceTimersByTime(1000);
        checkRateLimit('persistent-key', config);
        vi.advanceTimersByTime(1000);

        const result = checkRateLimit('persistent-key', config);
        expect(result.allowed).toBe(false);
      });
    });
  });

  describe('rateLimitResponse', () => {
    it('should return 429 status', () => {
      const response = rateLimitResponse(5000);
      expect(response.status).toBe(429);
    });

    it('should include error message', async () => {
      const response = rateLimitResponse(5000);
      const json = await response.json();
      expect(json.error).toContain('Too many requests');
    });

    it('should include Retry-After header in seconds', () => {
      const response = rateLimitResponse(5000);
      const retryAfter = response.headers.get('Retry-After');
      expect(retryAfter).toBe('5');
    });

    it('should calculate Retry-After correctly for various durations', () => {
      const testCases = [
        { ms: 1000, expected: '1' },
        { ms: 1500, expected: '2' },
        { ms: 60_000, expected: '60' },
        { ms: 59_500, expected: '60' },
      ];

      testCases.forEach(({ ms, expected }) => {
        const response = rateLimitResponse(ms);
        expect(response.headers.get('Retry-After')).toBe(expected);
      });
    });

    it('should have correct Content-Type', () => {
      const response = rateLimitResponse(5000);
      expect(response.headers.get('Content-Type')).toBe('application/json');
    });

    it('should return valid JSON in body', async () => {
      const response = rateLimitResponse(5000);
      const json = await response.json();
      expect(typeof json).toBe('object');
      expect('error' in json).toBe(true);
    });

    it('should handle zero milliseconds', () => {
      const response = rateLimitResponse(0);
      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('0');
    });

    it('should handle very large milliseconds', () => {
      const response = rateLimitResponse(3_600_000);
      expect(response.headers.get('Retry-After')).toBe('3600');
    });
  });

  describe('integration scenarios', () => {
    it('should handle realistic login attack scenario', () => {
      const attempts = [];
      for (let i = 0; i < 15; i++) {
        const result = checkRateLimit('user-ip-192.168.1.1', LOGIN_LIMIT);
        attempts.push(result);
        vi.advanceTimersByTime(1000);
      }

      expect(attempts.slice(0, 10).every(r => r.allowed)).toBe(true);
      expect(attempts.slice(10).some(r => !r.allowed)).toBe(true);
    });

    it('should handle AI endpoint rate limiting', () => {
      const userId = 'user-123';
      const results = [];

      for (let i = 0; i < 25; i++) {
        results.push(checkRateLimit(userId, AI_HEAVY_LIMIT));
      }

      expect(results.slice(0, 20).every(r => r.allowed)).toBe(true);
      expect(results.slice(20).every(r => !r.allowed)).toBe(true);
    });

    it('should track multiple users independently', () => {
      const user1Results = [];
      const user2Results = [];

      for (let i = 0; i < 3; i++) {
        user1Results.push(checkRateLimit('user-1', AI_HEAVY_LIMIT));
        user2Results.push(checkRateLimit('user-2', AI_HEAVY_LIMIT));
      }

      expect(user1Results.every(r => r.allowed)).toBe(true);
      expect(user2Results.every(r => r.allowed)).toBe(true);
    });
  });
});
