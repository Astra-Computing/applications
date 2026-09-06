import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { connect, applySchema, deleteRoom, testConnectionString } from './db';
import type { GameState } from '@/lib/types';

/**
 * Global setup for the API layer: build the application, start it against the
 * test database, prove it is actually talking to that database, and tear it
 * down again.
 *
 * Owns three things.
 *
 * The first, from U1, is the refusal: nothing runs until the resolved database
 * URL has been checked, because the failure that matters is a connection string
 * that is present and points at the live Supabase project.
 *
 * The second is the connection string's route into the server. `next start`
 * forces `NODE_ENV=production`, so Next loads `.env.local` — which in this repo
 * really does hold the production Supabase string and the production encryption
 * key — and ignores `.env.test` entirely. `@next/env` only fills in keys that
 * are absent from `process.env`, so the child's environment is what outranks
 * that file, and it is the only thing that does (KTD9).
 *
 * The third is proving it, in `assertServerReadsTestDatabase` below. A health
 * check says a database answered, not which one. Getting this wrong is silent
 * and the whole suite would then run against live games, so the setup plants a
 * row in the verified test database and refuses to continue unless the running
 * server can read it back.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * Port 3000, and it must stay in step with `scripts/guard-build.js`, which
 * refuses to build while anything is listening on exactly this port. Moving the
 * suite to another port would step around that guard rather than satisfying it,
 * and the guard exists because rebuilding under a live server serves chunk
 * names that 404 back as HTML.
 */
export const TEST_PORT = 3000;
export const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

/**
 * A fixed dummy key, deliberately not a real one and deliberately not read from
 * the environment.
 *
 * `GAME_ENCRYPTION_KEY` is mandatory under `next start` — `getEncryptionKey` in
 * src/lib/gameState.ts throws outright in production rather than falling back to
 * the committed dev key (R25) — so the harness must supply one. It is hardcoded
 * because the server and the test process have to agree: a room encrypted with
 * one key and read with another decrypts to nothing, `parseEnvelope` swallows
 * the error and returns null, and every route then answers 404 as if the room
 * had never existed. Taking this from the ambient environment would make that
 * mismatch depend on how the suite happened to be invoked.
 */
export const TEST_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** Room code used only by the setup's own database-identity probe. */
const SENTINEL_CODE = 'QQQQ';

// ── HTTP helpers ────────────────────────────────────────────────────────────
//
// Thin on purpose: tests assert on `res.status` directly, because the status
// code IS the requirement here (R12) and a helper that threw on a non-2xx
// would hide exactly what the layer exists to check.

export function apiGet(pathname: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE_URL}${pathname}`, { headers });
}

/**
 * POST with a JSON body. A string `body` is sent verbatim and NOT re-encoded,
 * which is what lets a test send a malformed payload — several routes have a
 * `catch` around `req.json()` returning 400, and that path is unreachable if
 * the helper always stringifies.
 */
export function apiPost(
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${BASE_URL}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/**
 * Rewrites one room's stored state from the test process, through the
 * application's own encryption and row lock.
 *
 * Only for the scenarios that turn on the passage of time. A player's seat is
 * held for `PLAYER_TIMEOUT_MS`, which is five minutes; "the name frees once that
 * player times out" cannot be tested by waiting, and there is no route that
 * backdates a heartbeat. Reaching in here is the alternative to making the
 * timeout configurable, which would be a change to src/ for the tests' benefit.
 *
 * The env assignment is load-bearing and must happen before the module is
 * loaded: `getEncryptionKey` reads `process.env` on every call, and under Vitest
 * `NODE_ENV` is `test`, so an unset key silently falls back to the committed dev
 * key instead of throwing — the state would be re-encrypted with a key the
 * server cannot read, and every later request on the room would 404.
 */
export async function mutateRoomState(
  roomCode: string,
  updater: (state: GameState) => GameState,
): Promise<GameState | null> {
  process.env.GAME_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  const { loadAndUpdate } = await import('@/lib/gameState');
  return loadAndUpdate(roomCode.toUpperCase(), updater);
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

function isPortInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let settled = false;
    const done = (inUse: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, '127.0.0.1');
  });
}

async function waitForPortFree(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortInUse(TEST_PORT))) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return !(await isPortInUse(TEST_PORT));
}

/** Runs a command to completion, keeping its output only to report a failure. */
function run(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const collect = (chunk: Buffer) => { output += chunk.toString(); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms\n${tail(output)}`));
    }, timeoutMs);
    child.once('error', err => { clearTimeout(timer); reject(err); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}\n${tail(output)}`));
    });
  });
}

function tail(text: string, lines = 30): string {
  return text.trimEnd().split('\n').slice(-lines).join('\n');
}

/**
 * Starts `next start` in its own process group.
 *
 * `detached: true` is not cosmetic: it is what makes the teardown able to kill
 * the whole group. A survivor holding port 3000 does not merely leak a process —
 * `scripts/guard-build.js` then refuses the NEXT run's build, so one crashed run
 * would block the suite until someone killed it by hand.
 */
function startServer(connectionString: string): ChildProcess {
  const bin = path.join(REPO_ROOT, 'node_modules', '.bin', 'next');
  const child = spawn(bin, ['start', '--hostname', '127.0.0.1', '--port', String(TEST_PORT)], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(TEST_PORT),
      // The two secrets a production build demands (R25), passed here rather
      // than through any file, because only the process environment beats
      // `.env.local` — see the header.
      SUPABASE_DB_URL: connectionString,
      GAME_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    },
  });
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', chunk => process.stderr.write(`[next] ${chunk}`));
  return child;
}

/** Polls until the server reports the database is reachable, not merely that it
 *  is listening — `/api/health` is `force-dynamic` precisely so this answer is
 *  live rather than a prerendered {status:'ok'}. */
async function waitForHealth(child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response yet';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited with code ${child.exitCode} before becoming healthy`);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      const body = await res.json() as { status?: string; db?: string };
      if (res.ok && body.db === 'up') return;
      last = `${res.status} ${JSON.stringify(body)}`;
    } catch (e) {
      last = (e as Error).message;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Server never reported db: up within ${timeoutMs}ms. Last: ${last}`);
}

/**
 * Proves the running server reads the same database this process just verified.
 *
 * `/api/health` only proves *a* database answered `SELECT 1`, and this repo's
 * `.env.local` holds the production string, so "healthy" is exactly what a
 * server wired to production would also report. The probe plants a room in the
 * test database and asks the server for it: a 200 means the server read this
 * row, with this key. Anything else aborts the run before a single test has
 * created anything.
 *
 * Read-only against the server and write-only against the already-allowlisted
 * test database, so the probe itself can never touch production.
 */
async function assertServerReadsTestDatabase(): Promise<void> {
  process.env.GAME_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  const { tryCreateState } = await import('@/lib/gameState');
  const { createGame } = await import('@/lib/gameLogic');
  const { getSql } = await import('@/lib/db');

  const sql = connect();
  try {
    await applySchema(sql);
    await deleteRoom(sql, SENTINEL_CODE);
    const state: GameState = {
      ...createGame([{ text: 'sentinel a', author: 'Setup' }, { text: 'sentinel b', author: 'Setup' }], 'sentinel-host'),
      roomCode: SENTINEL_CODE,
    };
    if (!(await tryCreateState(state))) {
      throw new Error(`Could not plant the sentinel room ${SENTINEL_CODE} in the test database.`);
    }

    const res = await apiGet(`/api/game/${SENTINEL_CODE}`);
    if (res.status !== 200) {
      throw new Error(
        `Refusing to run: the server answered ${res.status} for a room that exists in the test ` +
        'database. It is either connected to a different database (check that SUPABASE_DB_URL ' +
        'reached the child process and was not shadowed by .env.local) or using a different ' +
        'GAME_ENCRYPTION_KEY, in which case every room decrypts to nothing and reads as absent.'
      );
    }
    await deleteRoom(sql, SENTINEL_CODE);
  } finally {
    await sql.end();
    // The application's own lazily-created pool, opened by the imports above.
    // A different pool from `sql`, and an idle connection keeps Node alive.
    await getSql().end();
  }
}

export default async function setup() {
  // Throws on a missing string, and on one that names a Supabase host.
  const url = testConnectionString();

  const shown = url.replace(/:\/\/[^@]*@/, '://***@');
  console.log(`[test-db] ${shown}`);

  if (await isPortInUse(TEST_PORT)) {
    throw new Error(
      `Refusing to run: something is already listening on port ${TEST_PORT}.\n` +
      'The API layer will not test against it — it may be the Turbopack dev server, whose\n' +
      'per-route first-request compile takes 20-60s inside Docker and reads as a product bug,\n' +
      'and `npm run build` would refuse to run underneath it in any case.\n' +
      'Stop it first:\n' +
      "  docker exec dev-env sh -c \"pkill -9 -f next-server; pkill -9 -f 'next start'\""
    );
  }

  const buildEnv: NodeJS.ProcessEnv = {
    ...process.env,
    SUPABASE_DB_URL: url,
    GAME_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  };

  // Build BEFORE starting, never after: guard-build.js refuses a build while a
  // server is listening, and it is right to. Set UQ_TEST_REUSE_BUILD=1 only
  // while iterating on the tests themselves — it will happily serve a .next
  // from before your src/ change and report that stale behaviour as fact.
  if (process.env.UQ_TEST_REUSE_BUILD === '1') {
    console.log('[test-server] UQ_TEST_REUSE_BUILD=1 — reusing the existing .next, which may be stale');
  } else {
    console.log('[test-server] building…');
    const started = Date.now();
    await run('npm', ['run', 'build'], buildEnv, 600_000);
    console.log(`[test-server] built in ${Math.round((Date.now() - started) / 1000)}s`);
  }

  const child = startServer(url);

  // Best-effort synchronous net for a run that dies without teardown (a crash,
  // or Ctrl-C). Leaving the server up would block the next run's build.
  const reap = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } } };
  process.once('exit', reap);

  await waitForHealth(child, 90_000);
  await assertServerReadsTestDatabase();
  console.log(`[test-server] ${BASE_URL} is serving the test database`);

  return async () => {
    process.removeListener('exit', reap);
    if (child.pid && child.exitCode === null) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      if (!(await waitForPortFree(5_000))) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        await waitForPortFree(3_000);
      }
    }
  };
}
