import { sql } from './db';

// Rate limiting for POST /api/game/create, backed by Postgres instead of an
// in-process Map — this needs to live in the route handler (Node.js runtime),
// not middleware, since Next.js middleware always runs on the Edge runtime
// and can't hold a direct Postgres connection.

const LIMIT     = 10;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface RateLimitRow { ip: string; count: number; reset_at: Date }

export async function checkRateLimit(ip: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    const rows  = await tx<RateLimitRow[]>`SELECT ip, count, reset_at FROM rate_limits WHERE ip = ${ip} FOR UPDATE`;
    const now   = new Date();
    const entry = rows[0];

    if (!entry || entry.reset_at < now) {
      const resetAt = new Date(now.getTime() + WINDOW_MS);
      await tx`
        INSERT INTO rate_limits (ip, count, reset_at) VALUES (${ip}, 1, ${resetAt})
        ON CONFLICT (ip) DO UPDATE SET count = 1, reset_at = excluded.reset_at
      `;
      return true;
    }

    if (entry.count >= LIMIT) return false;

    await tx`UPDATE rate_limits SET count = count + 1 WHERE ip = ${ip}`;
    return true;
  });
}
