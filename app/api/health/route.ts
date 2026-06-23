import { NextResponse } from 'next/server';

/**
 * Health check endpoint for container orchestration platforms.
 * Returns 200 OK if app is healthy, 503 if unhealthy.
 * Used by: Azure Container App, AWS AppRunner, Cloud Run, Kubernetes readiness probes
 */
export async function GET() {
  try {
    return NextResponse.json(
      {
        ok: true,
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '0.1.0',
        environment: process.env.NODE_ENV || 'development',
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 503 }
    );
  }
}
