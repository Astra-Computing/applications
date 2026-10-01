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

  // Carried over from `_pw_voting.js`, which measured this width on every run.
  // The card is deliberately ONE home-page column wide (`max-width: 258px` in
  // globals.css - the 540px grid with a 1.5rem gap leaves 258px a side): it was
  // once a smaller button and read as a footnote rather than a third option, so
  // an unbounded card is a visible regression rather than a cosmetic one. The
  // driver asserted `<= 240` against a narrower viewport; the constraint the
  // stylesheet actually states is 258.
  const bmc = page.locator('.bmc-card');
  await expect(bmc).toBeVisible();
  const box = await bmc.boundingBox();
  expect(box, 'the Buy Me a Coffee card has no layout box').not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(258);
  // Not collapsed either - a zero-width box would satisfy the bound above.
  expect(box!.width).toBeGreaterThan(120);
});
