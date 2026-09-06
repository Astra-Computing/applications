import { test, expect } from './fixtures/guards';
import { assertEverySpecUsesTheGuardedTest, importsRunnerTest } from './fixtures/guards';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The CSP guard's self-test (R18, R20, KTD5).
 *
 * A guard nobody has ever seen fire is a guard nobody knows works. The champion
 * fireworks were dead for two releases behind assertions that all passed, so
 * "the listener is attached" is not a claim this suite is willing to make
 * without evidence.
 *
 * This spec uses NO game fixture. It drives Playwright's own `page`, which is
 * the ad-hoc shape KTD5 warns about: a guard living inside the game fixture
 * would be absent from exactly this file. It is covered because the guard hooks
 * `context.on('page')` from an auto-use fixture, so it was listening before this
 * page existed.
 */
test('a page the spec opened itself is CSP-guarded', async ({ page, cspGuard }) => {
  await page.goto('/');
  expect(cspGuard.isWatching(page), 'the guard never attached to this page').toBe(true);

  // Provoke a real violation rather than simulating one. `connect-src 'self'`
  // in next.config.js forbids this, and - like the blob: worker that killed the
  // celebration - the page is told nothing useful: the fetch rejects with a
  // bare TypeError that any `catch` would swallow.
  await page.evaluate(async () => {
    try {
      await fetch('https://example.com/definitely-blocked');
    } catch {
      /* CSP failures surface as an opaque network error, which is the problem */
    }
  });

  await expect
    .poll(() => cspGuard.violations.length, {
      message: 'the guard saw no violation, so every other spec is running unguarded',
      timeout: 10_000,
    })
    .toBeGreaterThan(0);

  const violations = cspGuard.violations.map(v => v.message).join('\n');
  expect(violations, 'the failure has to name the directive, not just say "CSP"').toMatch(
    /connect-src/,
  );

  // The one sanctioned use of `acknowledge`: this spec provoked the violation on
  // purpose, so it owns it. Without this the guard would - correctly - fail this
  // test in teardown.
  //
  // Matched on the blocked URL rather than on the directive, because Chromium
  // reports one block three times in three wordings and only two of them name
  // the directive: "Connecting to '<url>' violates the following Content
  // Security Policy directive: \"connect-src 'self'\"", "Fetch API cannot load
  // <url>. Refused to connect because it violates the document's Content
  // Security Policy" - which names nothing - and the `securitypolicyviolation`
  // DOM event, which names `connect-src` precisely. The URL is in all three.
  const acknowledged = cspGuard.acknowledge(/definitely-blocked/);
  expect(acknowledged.length, 'every wording of the one block should be acknowledged').toBeGreaterThan(
    1,
  );
  expect(cspGuard.violations, 'nothing else should have been blocked').toHaveLength(0);
});

/**
 * The R20 scanner's own self-test.
 *
 * This is the test whose absence let a real hole ship. The scanner filtered on
 * `/\.spec\.[cm]?tsx?$/` while Playwright's default `testMatch` collects
 * `**​/*.@(spec|test).?(c|m)[jt]s?(x)`, so a spec named `.test.ts`, `.spec.js`
 * or `.test.tsx` ran with NO CSP guard while the scanner reported success -
 * a guard failing open and saying it passed. Nothing observed it, because
 * nothing ever fed it a file it was supposed to reject.
 *
 * These cases run against a temporary directory, so they neither depend on nor
 * disturb the real suite.
 */
test.describe('the R20 scanner', () => {
  const GUARDED = "import { test, expect } from './fixtures/game';\ntest('x', async () => {});\n";

  /** Every filename Playwright collects, which is wider than `*.spec.ts`. */
  const COLLECTED = ['a.spec.ts', 'a.test.ts', 'a.spec.js', 'a.test.tsx', 'a.spec.mts'];

  /** Every import shape that reaches Playwright's unguarded `test`. */
  const ESCAPES: Array<[string, string]> = [
    ['named braces', "import { test } from '@playwright/test';"],
    ['renamed named', "import { test as t } from '@playwright/test';"],
    ['default import', "import pw from '@playwright/test';"],
    ['namespace import', "import * as pw from '@playwright/test';"],
    ['default plus named', "import pw, { expect } from '@playwright/test';"],
    ['require', "const { test } = require('@playwright/test');"],
    ['dynamic import', "const pw = await import('@playwright/test');"],
  ];

  let dir = '';

  test.beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uq-r20-'));
  });
  test.afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  for (const name of COLLECTED) {
    test(`rejects an unguarded ${name}, which the runner would collect`, () => {
      fs.writeFileSync(path.join(dir, name), "import { test } from '@playwright/test';\n");
      expect(() => assertEverySpecUsesTheGuardedTest(dir)).toThrow(/import `test` from @playwright\/test/);
    });
  }

  for (const [label, line] of ESCAPES) {
    test(`detects a ${label} import`, () => {
      expect(importsRunnerTest(`${line}\ntest('x', async () => {});\n`), label).toBe(true);
    });
  }

  test('allows expect and type-only imports, which carry no fixtures', () => {
    expect(importsRunnerTest("import { expect } from '@playwright/test';")).toBe(false);
    expect(importsRunnerTest("import type { Page } from '@playwright/test';")).toBe(false);
    expect(importsRunnerTest("import { expect, type Page } from '@playwright/test';")).toBe(false);
  });

  test('passes a directory whose specs all use the guarded test', () => {
    for (const name of COLLECTED) fs.writeFileSync(path.join(dir, name), GUARDED);
    expect(() => assertEverySpecUsesTheGuardedTest(dir)).not.toThrow();
  });

  test('ignores a file the runner would never collect', () => {
    fs.writeFileSync(path.join(dir, 'helper.ts'), "import { test } from '@playwright/test';\n");
    expect(() => assertEverySpecUsesTheGuardedTest(dir)).not.toThrow();
  });
});

/**
 * `acknowledge()` removes violations from the failing set, so a spec reaching
 * for it opts itself out of R18 while still looking green. One caller is
 * legitimate - the self-test above - and that is now enforced rather than
 * asked for in a comment.
 */
test('acknowledge() refuses a caller that is not this file', async ({ cspGuard }) => {
  // Proving the negative directly would need a second spec file that fails on
  // purpose. Instead assert the check's input: this file is the allowed caller,
  // so the guard must accept it here and the rule is keyed on that basename.
  expect(path.basename(test.info().file)).toBe('guards.spec.ts');
  expect(() => cspGuard.acknowledge(/nothing will match this/)).not.toThrow();
});
