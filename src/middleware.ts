// Rate limiting for POST /api/game/create.
// Uses a module-level in-process Map — works correctly only in single-process
// (containerised) deployments. In serverless, each cold start gets a fresh Map.
import { NextRequest, NextResponse } from 'next/server';

const ipMap = new Map<string, { count: number; resetAt: number }>();
const LIMIT     = 10;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

export function middleware(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           ?? req.headers.get('x-real-ip')
           ?? 'unknown';
  const now = Date.now();
  const entry = ipMap.get(ip);

  if (!entry || entry.resetAt < now) {
    ipMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else if (entry.count >= LIMIT) {
    return NextResponse.json(
      { error: 'Too many games created. Try again later.' },
      { status: 429 },
    );
  } else {
    entry.count++;
  }
}

export const config = { matcher: '/api/game/create' };
