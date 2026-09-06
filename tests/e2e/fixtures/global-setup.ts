import { connect, applySchema, resetDatabase, deleteRoom, roomExists } from '../../support/db';
import { BASE_URL } from '../../support/server';
import { assertServedBuildMatchesTree, assertEverySpecUsesTheGuardedTest } from './guards';

/**
 * Everything that must be true before the first browser opens.
 *
 * Runs after `webServer` has built, started and reported `db: up`: Playwright
 * installs `webServer` as a plugin, and plugin setup precedes `globalSetup` in
 * the runner's task list. So the server is up here, and these checks can ask it
 * questions rather than guess.
 *
 * Three refusals, in the order that fails cheapest first.
 */
export default async function globalSetup(): Promise<void> {
  // 1. R19/AE4 - is the running server the build in this tree? Build identity,
  //    not the version string: a rebuild moves every chunk hash while VERSION
  //    sits still, and that is the case that cost an afternoon.
  await assertServedBuildMatchesTree(BASE_URL);

  // 2. R20 - can any spec escape the CSP guard by importing Playwright's own
  //    `test`? Cheap, local, and the only hole in an auto-use fixture.
  assertEverySpecUsesTheGuardedTest();

  // 3. Is the server reading the database this process verified?
  await assertServerReadsTestDatabase();
}

/**
 * U4's sentinel probe, carried over as promised in playwright.config.ts.
 *
 * `/api/health` proves that A database answered `SELECT 1`, not WHICH one - and
 * this repo's `.env.local` holds the production Supabase string, so a server
 * wired to production reports exactly the same "healthy". Getting this wrong is
 * silent, and the whole browser suite would then create and delete rooms in live
 * games.
 *
 * The direction is reversed from U4's version, which planted a row with
 * `@/lib/gameState` and asked the server to read it back. That import cannot be
 * used here: `globalSetup` is loaded in the RUNNER process, where a dynamic
 * `import()` is invisible to Playwright's transform pass and the target arrives
 * untransformed - `SyntaxError: Cannot use import statement outside a module`
 * from inside the .ts file (see the note in playwright.config.ts). Asking the
 * SERVER to create the room and then looking for the row from here proves the
 * same thing with `fetch` and the `postgres` client alone, and is arguably
 * stronger: it exercises the write path the tests actually use.
 *
 * The truncate afterwards is not tidiness. Room creation is rate limited to ten
 * per hour per IP by application code (`src/lib/rateLimit.ts`), tests send no
 * `x-forwarded-for`, so every request in the suite keys to the same `'unknown'`
 * - and this probe would otherwise spend one of those ten before any test ran.
 */
async function assertServerReadsTestDatabase(): Promise<void> {
  const sql = connect();
  try {
    await applySchema(sql);
    await resetDatabase(sql);

    const res = await fetch(`${BASE_URL}/api/game/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        quotes: [
          { text: 'sentinel a', author: 'Setup' },
          { text: 'sentinel b', author: 'Setup' },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Refusing to run: the server answered ${res.status} to POST /api/game/create, so no room ` +
        'could be planted to identify its database. Nothing below this has been checked.',
      );
    }
    const { roomCode } = (await res.json()) as { roomCode: string };

    if (!(await roomExists(sql, roomCode))) {
      throw new Error(
        `Refusing to run: the server created room ${roomCode}, and that row is NOT in the test ` +
        'database this process just verified. The server is connected to a different database - ' +
        'check that SUPABASE_DB_URL reached the webServer child through `env` in ' +
        'playwright.config.ts and was not shadowed by .env.local, which in this repo holds the ' +
        'production Supabase string.',
      );
    }

    await deleteRoom(sql, roomCode);
    await resetDatabase(sql);
    // eslint-disable-next-line no-console
    console.log(`[e2e] ${BASE_URL} is serving this tree's build, from the test database`);
  } finally {
    await sql.end();
  }
}
