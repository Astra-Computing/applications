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
 * Hosts the suite is permitted to touch. Anything else is refused.
 *
 * The test database lives on the compose network as `test-db` (see the
 * workspace `docker-compose.yml`); the loopback names are here for a suite run
 * against a Postgres started by hand.
 */
const ALLOWED_HOSTS = new Set(['test-db', 'localhost', '127.0.0.1', '::1']);

/** Substrings that name the production project, kept so the refusal can say so. */
const PRODUCTION_MARKERS = ['supabase.co', 'supabase.com', 'pooler.supabase'];

/**
 * Refuses to continue against anything but the test database.
 *
 * The hazard is a connection string that is PRESENT and points at the live
 * project, not one that is missing — guarding only against absence would have
 * let the whole suite run against production while looking fine.
 *
 * This is an ALLOWLIST, and that shape is the point. It began as a denylist of
 * Supabase substrings, which default-allowed: `DB.ABCDEFGH.SUPABASE.CO` passed
 * on case alone, and so did any production database that is not Supabase. What
 * gets past here reaches `resetDatabase`, which truncates. A guard whose job is
 * "never touch production" has to fail closed, so an unrecognised host is
 * refused rather than permitted.
 */
export function assertNotProduction(url: string): void {
  let hostname: string;
  try {
    // `.toLowerCase()` is load-bearing and not belt-and-braces. `postgres:` is a
    // NON-SPECIAL URL scheme, so WHATWG parses the host as an opaque host and
    // preserves its case - `new URL('postgres://u:p@DB.X.SUPABASE.CO/d').hostname`
    // is `'DB.X.SUPABASE.CO'`, not the lowercased form an `http:` URL would give.
    // Comparing without this reintroduces the exact case bypass this allowlist
    // replaced. The replace strips the brackets the parser puts around IPv6.
    hostname = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    throw new Error(
      'Refusing to run: the resolved database URL could not be parsed, so its ' +
      'host cannot be checked. Set SUPABASE_DB_URL to the test database in the ' +
      'process environment.'
    );
  }

  if (ALLOWED_HOSTS.has(hostname)) return;

  const marker = PRODUCTION_MARKERS.find(needle => hostname.includes(needle));
  throw new Error(
    marker
      ? `Refusing to run: the resolved database URL points at "${hostname}", ` +
        'which is the production Supabase project. Tests must never write ' +
        'there. Set SUPABASE_DB_URL to the test database in the process ' +
        'environment.'
      : `Refusing to run: the resolved database URL points at "${hostname}", ` +
        `which is not a known test database (allowed: ${[...ALLOWED_HOSTS].join(', ')}). ` +
        'Refusing rather than guessing, because what runs here truncates every ' +
        'table. Set SUPABASE_DB_URL to the test database in the process ' +
        'environment.'
  );
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

/**
 * Whether one room is stored, asked of the database rather than of the server.
 *
 * Two callers, both of which must not go through an HTTP route. The browser
 * layer's global setup uses it to prove the running server writes to the
 * database this process verified, and its teardown test uses it to prove a room
 * really was deleted after a test threw - a question `GET /api/game/<code>` also
 * answers 404 to when the encryption keys merely disagree.
 */
export async function roomExists(sql: Sql, roomCode: string): Promise<boolean> {
  const rows = await sql<{ one: number }[]>`
    select 1 as one from game_states where room_code = ${roomCode.toUpperCase()} limit 1`;
  return rows.length > 0;
}

export async function countRooms(sql: Sql): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from game_states`;
  return row.n;
}
