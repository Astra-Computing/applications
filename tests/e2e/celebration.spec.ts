import { test, expect, expectCelebrationDrew } from './fixtures/game';

/**
 * The champion celebration drew something (R26, KTD6, AE3).
 *
 * This is the assertion the whole guard apparatus exists for. `canvas-confetti`
 * renders through an OffscreenCanvas worker built from a `blob:` URL; with no
 * `worker-src` in the CSP the fallback is `script-src`, which does not allow
 * `blob:`, and the browser blocks the worker without anything throwing. The
 * fireworks were dead on every deployed build for two releases while the
 * component mounted, the effect ran, and the canvas sat there present, sized,
 * visible, opacity 1, at z-index 100. Two verification passes asserted "a canvas
 * exists" and both passed.
 *
 * So this spec asserts pixels, and the CSP guard riding underneath it names the
 * directive if the header ever regresses. No screenshot baseline is involved -
 * a baseline costs more to re-approve than it catches (KTD6); the assertion is
 * that a strip of the canvas is not uniformly one colour mid-burst.
 */

test.use({ gameOptions: { players: ['Ana'] } });

test('the champion celebration draws on the host and on the player', async ({ game }) => {
  const rounds = await game.playToChampion();
  expect(rounds, 'four quotes should resolve in two rounds').toBe(2);

  await expect(game.host.locator('.champion-card')).toBeVisible();
  const player = game.players[0].page;
  await expect(player.locator('.champion-card')).toBeVisible({ timeout: 20_000 });

  // The host's confetti only mounts once the final recap slideshow has gone -
  // `{!slideshowActive && <Confetti />}` - and `showResults()` has skipped it.
  await Promise.all([
    expectCelebrationDrew(game.host, 'host'),
    expectCelebrationDrew(player, 'player'),
  ]);
});
