import { defineConfig, devices } from '@playwright/test';
import { testConnectionString } from './tests/support/db';
import { BASE_URL, TEST_PORT, TEST_ENCRYPTION_KEY } from './tests/support/server';

/**
 * The browser layer.
 *
 * Run it with `npm run test:e2e`. It is deliberately NOT part of `npm test`
 * (R21): `npm test` is the fast, browserless gate meant to run on every change,
 * and folding a build-plus-browser run into it would make people stop running
 * it.
 *
 * ── Why `webServer` and not U4's `tests/support/server.ts` ──────────────────
 *
 * The intent was to reuse that file. It already owns exactly this lifecycle for
 * the API layer - build, start against the test database, prove the running
 * server really is reading that database, kill the process group - and its shape
 * fits Playwright's `globalSetup` contract exactly: a default-exported async
 * function returning its own teardown, which the runner does call (see
 * `runner/index.js`: `if (typeof globalSetupResult === "function") await
 * globalSetupResult()`).
 *
 * It does not work, for a reason in Playwright rather than in that file, and it
 * was measured rather than assumed. `globalSetup` is loaded in the RUNNER
 * process, where Playwright transforms the file itself and the dependencies it
 * can see statically. A dynamic `import()` is invisible to that pass, so the
 * target is loaded untransformed and Node throws
 * `SyntaxError: Cannot use import statement outside a module` from inside the
 * imported .ts file. `tests/support/server.ts` reaches for `@/lib/gameState`,
 * `@/lib/gameLogic` and `@/lib/db` through `await import(...)` - deliberately, so
 * the module is loaded only after `GAME_ENCRYPTION_KEY` has been set - and every
 * one of them fails. It is not the `@/*` alias: a relative dynamic import of the
 * same file fails identically. Warming `require.cache` with a static import from
 * this config gets past the syntax error and is worse, not better: the module
 * then arrives through Node's CJS-to-ESM bridge with its named exports
 * undefined, so the setup would fail later and less clearly. Inside a spec, run
 * by a worker, those same dynamic imports are fine - this is specific to the
 * runner process.
 *
 * So the lifecycle is re-expressed here with `webServer`, and the parts of U4's
 * file that are constants rather than behaviour are imported rather than
 * retyped - see `TEST_PORT` and `TEST_ENCRYPTION_KEY` below.
 *
 * ── What is kept, and the one thing that is not ─────────────────────────────
 *
 * Kept:
 *  - Build BEFORE start, never after. `scripts/guard-build.js` refuses to build
 *    under a listening server and is right to (R31, KTD12).
 *  - The secrets travel in the child's process environment, which is the only
 *    thing that outranks `.env.local` - and `.env.local` in this repo really does
 *    hold the production Supabase string and key (KTD9, R25).
 *  - Readiness is `/api/health` answering 200, which that route only does once a
 *    database answered `SELECT 1`; it returns 503 otherwise, so waiting on it is
 *    waiting for `db: up` rather than for a port to open.
 *  - The refusal to touch production, via `testConnectionString()` below.
 *
 * Not kept: U4's sentinel probe, which plants a room in the verified test
 * database and refuses to continue unless the running server can read it back.
 * That is proof rather than mechanism - the mechanism, passing the string
 * through `env` below, is identical - but it is proof worth having, and
 * `webServer` has no hook for it. The natural home is an auto-use fixture in
 * U6, which owns `tests/e2e/fixtures/` and `tests/support/db.ts`. Until then a
 * misdirected server shows up as tests failing rather than as a named refusal.
 */

/**
 * Resolved and checked before anything is built or started.
 *
 * `testConnectionString()` throws on a missing string and on any host that is
 * not on the test allowlist, so a run pointed at the production Supabase project
 * dies here - at config load, before a build, a server or a browser exists
 * (R24, AE1). Reading it here rather than letting the child inherit it is what
 * makes that check unavoidable.
 */
const connectionString = testConnectionString();

/**
 * `UQ_TEST_REUSE_BUILD=1` skips the rebuild, exactly as the API layer's setup
 * does. Only for iterating on the specs themselves: it will happily serve a
 * `.next` from before your src/ change and report that stale behaviour as fact.
 */
// `npx next start` rather than `npm start`, because the `start` script already
// pins `--hostname 0.0.0.0` and appending a second `--hostname` would leave the
// bind address decided by argument-parsing order.
const startCommand = `npx next start --hostname 127.0.0.1 --port ${TEST_PORT}`;
const command =
  process.env.UQ_TEST_REUSE_BUILD === '1' ? startCommand : `npm run build && ${startCommand}`;

export default defineConfig({
  testDir: './tests/e2e',

  /**
   * Test files are transpiled against the test project, not the application
   * one. `tsconfig.json` excludes `tests` and `playwright.config.ts` so a broken
   * test cannot fail `next build` (KTD3, R23); naming the test project here is
   * what keeps the `@/*` path mapping resolving despite that exclusion, rather
   * than leaving it to whichever tsconfig Playwright finds walking up from each
   * file.
   */
  tsconfig: './tsconfig.test.json',

  webServer: {
    command,
    /**
     * Not the bare origin. `/api/health` is `force-dynamic` and answers 503
     * until the database responds, so this URL is a database readiness check
     * and not merely a "something is listening" one.
     */
    url: `${BASE_URL}/api/health`,
    /**
     * Never reuse. A server that was already running is a server whose build
     * nobody checked against the tree, which is the exact trap U6's staleness
     * guard exists for (R19, AE4) - and `next build` under a live server serves
     * chunk names that 404 back as HTML, which reads as a product bug for
     * hours. With this false, Playwright refuses outright if port 3000 is
     * already taken, which is the right answer rather than a convenience.
     */
    reuseExistingServer: false,
    /** A cold `next build` in this container is around three minutes. */
    timeout: 600_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // Both secrets a production build and `next start` demand (R25), passed
      // through the process environment because nothing else beats .env.local.
      SUPABASE_DB_URL: connectionString,
      // Imported, never re-typed. A server encrypting rooms with one key while
      // the test process reads with another decrypts to nothing, `parseEnvelope`
      // swallows the error, and every route answers 404 as if the room had never
      // existed.
      GAME_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      NODE_ENV: 'production',
    },
  },

  /**
   * One worker, and this is a correctness setting rather than a resource one
   * (KTD10, R6). Isolation here is a single shared database reset by
   * truncation; two workers means one file's truncate deleting rows another is
   * asserting on. Per-worker databases would be the alternative, and that is a
   * build rather than a setting. `fullyParallel: false` says the same for tests
   * within one file.
   */
  workers: 1,
  fullyParallel: false,

  /**
   * Never retry. A retry that passes turns a real intermittent defect into a
   * green run, and this layer exists to catch exactly the timing bugs a retry
   * would paper over.
   */
  retries: 0,

  /** `test.only` left in a file is a local convenience and a CI mistake. */
  forbidOnly: !!process.env.CI,

  /** A whole game - paste, join, vote through to a champion - is not a 30s
   *  test. The per-assertion timeout stays short so a missing element fails
   *  fast inside that budget. */
  timeout: 120_000,
  expect: { timeout: 10_000 },

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,

    /**
     * R17: a failed browser test has to be diagnosable without re-running it. A
     * trace carries the DOM, the network, the console and a screenshot per
     * step; open one with `npx playwright show-trace <path>`.
     *
     * On failure ONLY. Tracing every passing run costs seconds and disk per
     * test and buries the one trace anybody wants.
     *
     * Note what is deliberately absent: no `toHaveScreenshot` baselines and no
     * `snapshotPathTemplate`. Motion is asserted by liveness - a captured region
     * that is not uniformly blank - never by a golden image, which is flaky and
     * costs more to re-approve than it catches (KTD6). The screenshot and video
     * below are evidence attached to a failure, which is not the same thing as a
     * baseline to compare against.
     */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    /**
     * Chromium will not start its sandbox as root, and everything here runs as
     * root inside the dev-env container. Every one of the bespoke drivers this
     * suite replaces launched with the same flag.
     */
    launchOptions: { args: ['--no-sandbox'] },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
