import { test as base, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The two standing guards, and the `test` object every browser spec must import.
 *
 * Both exist because of a defect that was invisible to every signal short of
 * looking at the screen, and both are deliberately impossible for a spec to
 * skip (R18, R19, R20).
 *
 * ── Guard 1: Content Security Policy violations (R18) ───────────────────────
 *
 * The champion fireworks never fired on any deployed build and were silently
 * dead for two releases. `canvas-confetti` renders through an OffscreenCanvas
 * worker built from a `blob:` URL. `next.config.js` set no `worker-src`, so the
 * CSP fell back to `script-src`, which does not allow `blob:`, and the browser
 * blocked the worker.
 *
 * It fails SILENTLY. `new Worker()` does not throw - CSP kills it
 * asynchronously - so canvas-confetti creates its canvas, transfers control
 * offscreen, and never draws. The component mounted, the effect ran, the canvas
 * was present, sized, visible, opacity 1, at z-index 100. Two verification
 * passes asserted "a canvas exists" and both passed.
 *
 * The one place the browser DOES say something is the console, and the
 * `securitypolicyviolation` event. This guard listens to both.
 *
 * ── Guard 2: build identity (R19) ───────────────────────────────────────────
 *
 * Rebuilding under a live `next start` replaces the hashed chunks the running
 * server still advertises. They 404 back as `text/html`, the browser refuses to
 * execute them, React never hydrates, and every page looks blank or dead while
 * handlers silently never fire. It reads exactly like a product bug and is not
 * one; it cost an afternoon and three separate false bug hunts.
 *
 * The comparison is the BUILD IDENTITY, not the version string. `next build`
 * mints a fresh `.next/BUILD_ID` and fresh chunk hashes on every run, whether or
 * not anybody touched `VERSION` in src/app/layout.tsx - so a version check would
 * have passed straight through the exact case this guard exists for (AE4). The
 * version string is carried in the message for a human to read, and for nothing
 * else.
 *
 * ── Why they are here and not in the game fixture (KTD5) ────────────────────
 *
 * A guard that only covers pages the game fixture built is absent from exactly
 * the ad-hoc spec most likely to need it. So:
 *
 *  - the CSP guard is an AUTO-USE fixture that hooks `context.on('page')`, which
 *    covers pages a spec opens for itself, not just fixture-built ones;
 *  - the build check runs once, in global setup, before any test exists;
 *  - and `assertEverySpecUsesTheGuardedTest()` (also global setup) refuses the
 *    run if any spec imports `test` from `@playwright/test` directly, which is
 *    the only way a spec could escape the first guard.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');

// ── Guard 1: Content Security Policy ────────────────────────────────────────

export type CspViolation = {
  /** Where the violation was seen. */
  pageUrl: string;
  /** The browser's own words, kept verbatim so the failure names the directive. */
  message: string;
};

/**
 * Matches the console message Chromium emits for a blocked resource.
 *
 * Deliberately anchored on "Content Security Policy" and NOT on "Refused",
 * which is a genuine false positive in this repo: `@vercel/analytics` requests
 * `/_vercel/insights/script.js`, which only exists on Vercel and 404s back as
 * HTML anywhere else, producing "Refused to execute script ... because its MIME
 * type ('text/html') is not executable". That is a MIME-sniffing refusal, not a
 * CSP one, and failing every test on it would have got this guard deleted.
 */
const CSP_CONSOLE = /content security policy/i;

export class CspGuard {
  private readonly seen: CspViolation[] = [];
  private readonly acknowledged: CspViolation[] = [];
  private readonly contexts = new WeakSet<BrowserContext>();
  private readonly pages = new WeakSet<Page>();

  /** Every violation this guard has recorded and not been told to expect. */
  get violations(): readonly CspViolation[] {
    return this.seen;
  }

  /**
   * Attach to a browser context, and to every page it opens from now on.
   *
   * Hooking the CONTEXT rather than a page is the point: a spec that calls
   * `context.newPage()` itself, or a click that opens a second tab, is covered
   * without the spec knowing this guard exists. Call it on any extra context a
   * fixture or spec creates - `tests/e2e/fixtures/game.ts` does exactly that for
   * the host and each player.
   */
  async watch(context: BrowserContext): Promise<void> {
    if (this.contexts.has(context)) return;
    this.contexts.add(context);

    // The DOM event is the precise signal: it carries the directive that was
    // violated rather than a sentence to be regex'd. It is routed out of the
    // page through a binding because a violation has to fail the NODE-side test,
    // not sit in a page variable nobody reads.
    await context.exposeBinding(
      '__uqReportCspViolation',
      ({ page }, detail: { directive: string; blockedURI: string }) => {
        this.record(page.url(), `${detail.directive} blocked ${detail.blockedURI || '(inline)'}`);
      },
    );
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', event => {
        const report = (window as unknown as {
          __uqReportCspViolation?: (d: { directive: string; blockedURI: string }) => void;
        }).__uqReportCspViolation;
        report?.({
          directive: event.effectiveDirective || event.violatedDirective,
          blockedURI: event.blockedURI,
        });
      });
    });

    context.on('page', page => this.watchPage(page));
    for (const page of context.pages()) this.watchPage(page);
  }

  /** True if this page is covered. Only the guard's own self-test needs it. */
  isWatching(page: Page): boolean {
    return this.pages.has(page);
  }

  /**
   * Move violations matching `pattern` out of the failing set.
   *
   * For ONE caller: `tests/e2e/guards.spec.ts`, which provokes a violation on a
   * page it opened itself in order to prove this guard sees it. Reaching for
   * this anywhere else is opting out of R18, which is the requirement the whole
   * file exists to serve.
   */
  acknowledge(pattern: RegExp): CspViolation[] {
    const matched: CspViolation[] = [];
    for (let i = this.seen.length - 1; i >= 0; i--) {
      if (pattern.test(this.seen[i].message)) matched.unshift(...this.seen.splice(i, 1));
    }
    this.acknowledged.push(...matched);
    return matched;
  }

  /** Throws, naming every violation, if the run saw any. */
  assertNone(): void {
    if (this.seen.length === 0) return;
    const lines = this.seen.map(v => `  - ${v.message}\n      seen on ${v.pageUrl}`).join('\n');
    this.seen.length = 0;
    throw new Error(
      'Content Security Policy violation (R18). The browser blocked something, and a CSP\n' +
      'block is SILENT in the page - nothing throws, so the feature simply never happens:\n' +
      `${lines}\n\n` +
      'The CSP is built in next.config.js. This is exactly how the champion fireworks were\n' +
      'dead for two releases: worker-src was unset, script-src does not allow blob:, and\n' +
      'canvas-confetti’s OffscreenCanvas worker was blocked without an error anywhere.',
    );
  }

  private watchPage(page: Page): void {
    if (this.pages.has(page)) return;
    this.pages.add(page);
    page.on('console', msg => {
      const text = msg.text();
      if (CSP_CONSOLE.test(text)) this.record(page.url(), text);
    });
  }

  private record(pageUrl: string, message: string): void {
    // The same block is reported twice - once by the console, once by the DOM
    // event - and the two wordings differ, so dedupe on the pair rather than on
    // the message alone.
    if (this.seen.some(v => v.message === message && v.pageUrl === pageUrl)) return;
    this.seen.push({ pageUrl, message });
  }
}

/**
 * The `test` object every spec in this suite imports, directly or through
 * `./game`.
 *
 * `cspGuard` is `auto: true`, so it is set up for every test whether or not the
 * test mentions it, and its teardown runs whether the test passed, failed or
 * threw. Automatic fixtures are set up before the other fixtures of their scope,
 * so the listeners are attached before Playwright's own `page` fixture opens the
 * first page.
 */
export const test = base.extend<{ cspGuard: CspGuard }>({
  cspGuard: [
    async ({ context }, use) => {
      const guard = new CspGuard();
      await guard.watch(context);
      try {
        await use(guard);
      } finally {
        guard.assertNone();
      }
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';

// ── Guard 2: build identity ─────────────────────────────────────────────────

/** Directory names under /_next/static/ that are not a build id. */
const NOT_A_BUILD_ID = new Set(['chunks', 'css', 'media']);

function treeBuildId(): string {
  const file = path.join(REPO_ROOT, '.next', 'BUILD_ID');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    throw new Error(
      `Refusing to run: ${file} does not exist, so there is no build in the tree to compare\n` +
      'the running server against. Run `npm run build` first (with nothing listening on port\n' +
      '3000), or let playwright.config.ts’s webServer do it.',
    );
  }
}

/** The version string, for a human reading the failure. Never for the comparison. */
function treeVersion(): string {
  try {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'app', 'layout.tsx'), 'utf8');
    return src.match(/const VERSION = '([^']+)'/)?.[1] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * The build id the served page advertises, or null if it advertises none.
 *
 * Two shapes, because this app is App Router. The `/_next/static/<buildId>/`
 * path segment the plan describes is a PAGES Router shape - under the App Router
 * every `/_next/static/` path is `chunks/`, `css/` or `media/`, and the build id
 * travels instead inside the RSC flight payload as `"buildId":"..."` (escaped,
 * since it is embedded in a JS string literal in the HTML). Same value as
 * `.next/BUILD_ID`, same purpose; both forms are read so the guard keeps working
 * if a route ever moves.
 */
export function servedBuildId(html: string): string | null {
  // Pages Router: `/_next/static/<buildId>/_buildManifest.js`.
  const manifest = html.match(/\/_next\/static\/([^/"'\s]+)\/_(?:build|ssg)Manifest\.js/);
  if (manifest) return manifest[1];
  // App Router: the flight payload, with the quotes backslash-escaped.
  const flight = html.match(/\\?"buildId\\?":\\?"([A-Za-z0-9_-]+)/);
  if (flight) return flight[1];
  for (const m of html.matchAll(/\/_next\/static\/([^/"'\s]+)\//g)) {
    if (!NOT_A_BUILD_ID.has(m[1])) return m[1];
  }
  return null;
}

/**
 * Refuses the run when the build being served is not the build in the tree
 * (R19, AE4).
 *
 * Runs once, in global setup, against the server Playwright's `webServer`
 * started - so it aborts before a single test has opened a browser, rather than
 * letting the whole suite fail somewhere in the middle of a game.
 */
export async function assertServedBuildMatchesTree(baseUrl: string): Promise<void> {
  const expected = treeBuildId();

  const res = await fetch(`${baseUrl}/`, { headers: { 'cache-control': 'no-cache' } });
  const html = await res.text();
  const served = servedBuildId(html);

  if (!served) {
    throw new Error(
      `Refusing to run: ${baseUrl}/ referenced no /_next/static/<buildId>/ script at all, so\n` +
      'the build it is serving cannot be identified. That is what a dev server, an error\n' +
      `page or a proxy looks like. The tree is at build ${expected} (v${treeVersion()}).`,
    );
  }

  if (served !== expected) {
    throw new Error(
      'Refusing to run: the server is serving a different build from the one in the tree (R19).\n' +
      `  tree   .next/BUILD_ID   ${expected}\n` +
      `  served ${baseUrl}/      ${served}\n` +
      `  version in both         v${treeVersion()}  ← unchanged, and that is the point\n\n` +
      'Almost always: something ran `next build` while this server was already up. That\n' +
      'replaces the hashed chunks the running process still advertises; they 404 back as\n' +
      'text/html, the browser refuses to execute them, React never hydrates, and every page\n' +
      'looks blank or dead while handlers silently never fire. It reads exactly like a\n' +
      'product bug and is not one.\n\n' +
      'Stop the server, then build, then start:\n' +
      "  docker exec dev-env sh -c \"pkill -9 -f next-server; pkill -9 -f 'next start'\"",
    );
  }

  await assertAdvertisedChunksResolve(baseUrl, html, expected);
}

/**
 * The second half of the same guard: the chunks the page names actually load.
 *
 * The build id catches a rebuild, and a rebuild is the usual cause. This catches
 * the SYMPTOM directly, and it is the symptom that cost the afternoon: a chunk
 * that 404s comes back as `text/html`, the browser refuses to execute it on MIME
 * grounds, React never hydrates, and every page looks blank or dead while
 * handlers silently never fire. Chunk names are content-hashed, so they can
 * outlive a build id change - which is exactly when this half earns its keep.
 */
async function assertAdvertisedChunksResolve(
  baseUrl: string,
  html: string,
  buildId: string,
): Promise<void> {
  const chunks = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[^"'\s\\]+?\.js/g)].map(m => m[0]))];
  if (chunks.length === 0) {
    throw new Error(
      `Refusing to run: ${baseUrl}/ named no /_next/static/chunks/*.js at all, so nothing it ` +
      'depends on could be checked. That is what an error page looks like, not a built app.',
    );
  }

  for (const chunk of chunks) {
    const res = await fetch(`${baseUrl}${chunk}`);
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && /javascript|ecmascript/i.test(type)) continue;
    throw new Error(
      'Refusing to run: the server advertises a script it cannot serve (R19).\n' +
      `  ${chunk}\n` +
      `  answered ${res.status} as "${type || 'no content-type'}"\n` +
      `  tree build id ${buildId}\n\n` +
      'The browser refuses to execute that, React never hydrates, and every page looks blank\n' +
      'or dead while handlers silently never fire. Rebuild with nothing listening on port 3000.',
    );
  }
}

// ── R20: no spec can escape the guards ──────────────────────────────────────

/**
 * Refuses the run if any browser spec imports `test` from `@playwright/test`.
 *
 * The CSP guard rides on the `test` object exported above. A spec that imports
 * Playwright's own `test` gets a run with no guard and no warning - which is
 * precisely the "without a test opting in" that R20 forbids - and nothing about
 * such a spec looks wrong. So it is refused mechanically rather than left to a
 * review.
 *
 * Importing types or `expect` from `@playwright/test` is fine and common; only
 * `test` carries the fixtures.
 */
export function assertEverySpecUsesTheGuardedTest(specDir = path.join(REPO_ROOT, 'tests', 'e2e')): void {
  const offenders: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.spec\.[cm]?tsx?$/.test(entry.name)) continue;
      const src = fs.readFileSync(full, 'utf8');
      // `import { test ... } from '@playwright/test'` in any spacing or order.
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@playwright\/test['"]/g)) {
        const named = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
        if (named.includes('test')) offenders.push(path.relative(REPO_ROOT, full));
      }
    }
  };
  walk(specDir);

  if (offenders.length) {
    throw new Error(
      'Refusing to run: these specs import `test` from @playwright/test directly, so they run\n' +
      'with no CSP guard (R18, R20):\n' +
      offenders.map(f => `  - ${f}`).join('\n') +
      "\n\nImport it from the fixtures instead:\n" +
      "  import { test, expect } from './fixtures/game';    // needs a room\n" +
      "  import { test, expect } from './fixtures/guards';  // drives its own pages",
    );
  }
}
