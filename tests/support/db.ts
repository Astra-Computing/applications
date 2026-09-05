import postgres, { type Sql } from 'postgres';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Test-database access for the API and browser layers.
 *
 * Everything here goes through the `postgres` npm client the application
 * already depends on, rather than `psql` — there is no Postgres client binary
 * in the dev-env image, and installing one would be destroyed by the next
 * `stop-dev.ps1` exactly as Playwright's system libraries used to be.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * The connection string, taken from the process environment only.
 *
 * NOT from a `.env` file, and this is the single most important line in the
 * test harness. `next start` forces `NODE_ENV=production`, so Next loads
 * `.env.local` — which holds the real production Supabase string — and never
 * reads `.env.test`, which it only consults when `NODE_ENV` is `test`. Only
 * the process environment outranks it.
 */
export function testConnectionString(): string {
  const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'No test database configured. Set SUPABASE_DB_URL in the process ' +
      'environment of the command that runs the suite — not in a .env file.'
    );
  }
  assertNotProduction(url);
  return url;
}

/**
 * Refuses to continue against production.
 *
 * The hazard is a connection string that is PRESENT and points at the live
 * project, not one that is missing — guarding only against absence would have
 * let the whole suite run against production while looking fine.
 */
export function assertNotProduction(url: string): void {
  const banned = ['supabase.com', 'supabase.co', 'pooler.supabase'];
  const hit = banned.find(needle => url.includes(needle));
  if (hit) {
    throw new Error(
      `Refusing to run: the resolved database URL contains "${hit}", so it ` +
      'points at the production Supabase project. Tests must never write ' +
      'there. Set SUPABASE_DB_URL to the test database in the process ' +
      'environment.'
    );
  }
}

export function connect(): Sql {
  // prepare:false mirrors the application's own client so behaviour matches.
  return postgres(testConnectionString(), {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    // "relation already exists, skipping" on every re-run is noise, and noise
    // is how a suite stops being read.
    onnotice: () => {},
  });
}

/** Applies the schema half. Never the cron half — see supabase/cron.sql. */
export async function applySchema(sql: Sql): Promise<void> {
  const ddl = readFileSync(path.join(REPO_ROOT, 'supabase', 'schema.sql'), 'utf8');
  await sql.unsafe(ddl);
}

/**
 * Empties both tables.
 *
 * `rate_limits` matters as much as `game_states`: the ten-creates-per-hour cap
 * is application code (`src/lib/rateLimit.ts`), not a Supabase quota, so it
 * follows the suite to any database. Tests send no `x-forwarded-for`, so every
 * request keys to the same `'unknown'` IP — eleven room creations in one file
 * would trip the limiter without this.
 */
export async function resetDatabase(sql: Sql): Promise<void> {
  await sql`truncate table game_states, rate_limits`;
}

/** Deletes one room directly, for browser-test teardown that must not depend
 *  on a live session or an authenticated request. */
export async function deleteRoom(sql: Sql, roomCode: string): Promise<void> {
  await sql`delete from game_states where room_code = ${roomCode.toUpperCase()}`;
}

export async function countRooms(sql: Sql): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from game_states`;
  return row.n;
}
