import { type NextRequest, NextResponse } from 'next/server';

/**
 * Next.js Edge Middleware — two responsibilities:
 *
 * 1. CSRF protection: rejects state-changing requests whose Origin header does
 *    not match the Host header.  Browsers always send Origin on cross-origin
 *    requests; same-origin requests either omit it or match the host.
 *
 * 2. First-layer auth gate: rejects any /api/* request that lacks a session
 *    cookie.  Full session validation (signature + expiry lookup against the
 *    in-memory/persistent store) is performed inside each route handler — this
 *    is a cheap fast-fail at the edge before the handler is invoked.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only guard API routes
  if (!pathname.startsWith('/api/')) return NextResponse.next();

  // Auth routes are public — login/logout/me must be reachable without a session
  if (pathname.startsWith('/api/auth/')) return NextResponse.next();

  // ── CSRF: reject cross-origin mutating requests ───────────────────────────
  const method = request.method;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const origin = request.headers.get('origin');
    if (origin) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        // Malformed Origin header — block the request
        return new NextResponse(
          JSON.stringify({ error: 'Invalid Origin header' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const host = request.headers.get('host') ?? '';
      if (originHost !== host) {
        return new NextResponse(
          JSON.stringify({ error: 'Cross-origin request blocked' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }
  }

  // ── First-layer auth: session cookie must be present ─────────────────────
  const sessionId = request.cookies.get('sessionId')?.value;
  if (!sessionId) {
    return new NextResponse(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
