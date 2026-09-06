import { test, expect } from './fixtures/guards';

/**
 * The runner's own smoke test (U5), not game coverage.
 *
 * What it proves is that the harness underneath it works: Playwright found a
 * browser on the bind mount rather than downloading one, the `webServer` in
 * playwright.config.ts built the application and started it against the test
 * database, `baseURL` points at that server, and a page rendered. Every later
 * spec depends on all of that, and none of them would say so when it breaks -
 * they would fail somewhere in the middle of a game instead.
 *
 * Deliberately thin. The fixtures are U6 and the real whole-game flows are U7;
 * this file should not grow into them.
 *
 * It uses no game fixture and builds nothing, which is exactly why it also
 * stands as the proof for R20: `test` comes from `./fixtures/guards`, so this
 * spec runs under the standing CSP guard without asking for it and without
 * mentioning it. Global setup refuses the whole run if any spec imports `test`
 * from `@playwright/test` instead, which is the only way one could opt out.
 */
test('the landing page renders from the production build', async ({ page }) => {
  await page.goto('/');

  // Asserting on the two entry points rather than on a heading, because those
  // links ARE the landing page's job and they are what U7's flows start from.
  await expect(page.getByRole('link', { name: 'Host', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Join', exact: true })).toBeVisible();

  await expect(page).toHaveTitle(/UN\]Quotable/);
});
