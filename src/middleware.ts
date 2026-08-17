// Rate limiting for POST /api/game/create.
// Backed by Upstash Redis (via @upstash/ratelimit) so limits are enforced
// consistently across serverless function instances, not just per-process.
import { NextRequest, NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { redis } from '@/lib/redis';

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 h'),
  prefix: 'ratelimit:create',
  analytics: false,
});

export async function middleware(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
           ?? req.headers.get('x-real-ip')
           ?? 'unknown';

  const { success } = await ratelimit.limit(ip);
  if (!success) {
    return NextResponse.json(
      { error: 'Too many games created. Try again later.' },
      { status: 429 },
    );
  }
}

export const config = { matcher: '/api/game/create' };
