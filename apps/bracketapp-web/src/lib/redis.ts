import { Redis } from '@upstash/redis';

// Vercel's Marketplace "Upstash for Redis" integration commonly injects
// KV_REST_API_URL / KV_REST_API_TOKEN (legacy Vercel KV naming carried over).
// @upstash/redis's own Redis.fromEnv() only looks for UPSTASH_REDIS_REST_URL /
// UPSTASH_REDIS_REST_TOKEN. Support both so this works regardless of which
// naming the provisioned integration used.
const url   = process.env.UPSTASH_REDIS_REST_URL   ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

if (!url || !token) {
  throw new Error(
    'Missing Redis env vars: set UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN ' +
    '(or KV_REST_API_URL/KV_REST_API_TOKEN if provisioned via Vercel Marketplace).'
  );
}

export const redis = new Redis({ url, token });
