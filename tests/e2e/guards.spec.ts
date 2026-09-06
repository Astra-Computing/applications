import { test, expect } from './fixtures/guards';

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
