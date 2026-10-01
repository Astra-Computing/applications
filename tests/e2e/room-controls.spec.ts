import { test, expect, joinRoom } from './fixtures/game';

/**
 * The v0.6.0 room controls, ported from `_pw_v060.js` (U7, R14).
 *
 * Two tests, two rooms, and that is the whole budget this file is allowed:
 * `/api/game/create` is rate limited to ten per hour per IP in application code
 * (`src/lib/rateLimit.ts`) and every request the suite makes keys to the same
 * `'unknown'` IP.
 *
 * The first test never starts a game - it is entirely about the lobby - so it
 * costs a room and about fifteen seconds. The second plays a whole game without
 * the host touching the forward control once, which is the only way to prove
 * auto-advance does what it claims.
 */

/**
 * Nine quotes. ODD, and that is the point.
 *
 * `BracketDiagram` places every box at the mean of the boxes feeding it. An odd
 * count forces a BYE, a BYE gives a box a single feeder, and a single feeder on
 * an odd boundary used to land a box exactly on top of its neighbour - 905
 * overlapping boxes per 1000 simulated games before the fix. An even book never
 * exercises any of it.
 *
 * Nine also gives rounds of 5 / 3 / 2 / 1, so a BYE appears on more than one
 * boundary rather than only the first.
 */
const ODD_BOOK = [
  '"The bracket is the message" - Marshall',
  '"I have one rule: never lie" — Corbin',
  '"A still wave is shape, not motion" - Ana',
  '"Ship it and see" — Ben',
  '"Consent is the whole game" - Cara',
  '"Nobody reads the footer" - Dee',
  '"Round two is where it gets honest" - Eli',
  '"The BYE is not a prize" - Fay',
  '"Say the quiet part" - Gus',
].join('\n');

test.use({
  gameOptions: { players: ['Ana', 'Ben', 'Cara'], quotebook: ODD_BOOK },
});

test('the QR enlarges and dismisses three ways, and a kicked player can rejoin', async ({
  game,
}) => {
  test.setTimeout(180_000);

  const host = game.host;
  const overlay = host.locator('.qr-overlay');
  const trigger = host.locator('.host-qr-button');

  // A real <button>, not a click-handling div. Everything else in this file is
  // about behaviour; this is about the element being reachable by keyboard at
  // all, which a div silently is not.
  await expect(trigger).toHaveJSProperty('tagName', 'BUTTON');
  await expect(trigger).toBeEnabled();

  // 1. Escape.
  await trigger.click();
  await expect(overlay).toBeVisible();
  await host.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);

  // 2. A click outside the card. The card stops its own clicks from reaching
  //    the click-away handler, so this has to land on the backdrop - hence the
  //    explicit corner position rather than a centred click, which would hit
  //    the card and dismiss nothing.
  await trigger.click();
  await expect(overlay).toBeVisible();
  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(overlay).toHaveCount(0);

  // 3. The Close button inside the card.
  await trigger.click();
  await expect(overlay).toBeVisible();
  await overlay.getByRole('button', { name: 'Close' }).click();
  await expect(overlay).toHaveCount(0);

  // ── Kick, and rejoin ──────────────────────────────────────────────────────
  const cara = game.players[2];
  expect(cara.name).toBe('Cara');

  const chip = host.locator('.chip-kick', { hasText: 'Cara' });
  await expect(chip).toHaveJSProperty('tagName', 'BUTTON');
  await chip.click();

  // The confirmation names the player. A kick dialog that says "Remove this
  // player?" is one misclick away from removing the wrong one, and the host is
  // reading a roster of chips that all look alike.
  const confirm = host.locator('.overlay .overlay-card');
  await expect(confirm).toContainText('Remove Cara?');
  await confirm.getByRole('button', { name: 'Remove' }).click();

  await expect(host.locator('.chip-kick')).toHaveCount(2, { timeout: 30_000 });

  // The removed player is TOLD, on their own 2 s poll, rather than being left
  // staring at a board that has stopped changing.
  await expect(cara.page.locator('.alert-info')).toContainText(/removed you/i, { timeout: 30_000 });
  expect(
    await cara.page.evaluate(c => localStorage.getItem(`uq_session_${c}`), game.code),
    'the removed player kept a session token, so the next poll re-authenticates them into a ' +
    'room the host just removed them from',
  ).toBeNull();

  // And they can come back, through the app's own route out of that screen.
  await cara.page.getByRole('button', { name: /Join again/i }).click();
  await cara.page.waitForURL(/\/join/);
  await joinRoom(cara.page, game.code, cara.name);
  await expect(host.locator('.chip-kick')).toHaveCount(3, { timeout: 30_000 });
});

test('auto-advance reaches a champion with no host button presses', async ({ game }) => {
  test.setTimeout(360_000);

  const host = game.host;

  /**
   * The claim is a NEGATIVE one, so it is measured rather than asserted by
   * omission. A counter on the document in capture phase survives React's
   * re-renders (the listener is on the document, not on the button), and it
   * counts what a human would call pressing the forward control - including a
   * press this test made by accident, which is exactly the failure a "we simply
   * did not click it" argument cannot catch.
   */
  await host.evaluate(() => {
    const w = window as unknown as { __uqHeaderPresses?: number };
    w.__uqHeaderPresses = 0;
    document.addEventListener(
      'click',
      event => {
        const target = event.target as HTMLElement | null;
        if (target?.closest?.('.round-header .btn-primary')) w.__uqHeaderPresses = (w.__uqHeaderPresses ?? 0) + 1;
      },
      true,
    );
  });

  await game.startGame();

  await host.check('.auto-advance input');
  expect(
    await host.evaluate(c => localStorage.getItem(`uq_auto_${c}`), game.code),
    'auto-advance is not persisted per room, so a host who reloads silently gets a different game',
  ).toBe('1');

  // From here the host is never touched except to skip the recap - Space, on the
  // window, not a control. Without that the pass would spend the full recap on
  // every round for nothing; auto-advance deliberately waits for the recap to
  // finish, so skipping it changes the pace and not the path.
  let rounds = 0;
  while (!(await game.isOver())) {
    expect(rounds, 'nine quotes should resolve well inside eight rounds').toBeLessThan(8);
    await game.voteRound();
    await game.skipSlideshow();
    rounds++;
  }
  // 9 → 5 → 3 → 2 → 1 matchups: four rounds, and every boundary but the last
  // carries a BYE.
  expect(rounds).toBe(4);

  expect(
    await host.evaluate(() => (window as unknown as { __uqHeaderPresses?: number }).__uqHeaderPresses),
    'the game reached its champion, but the forward control was pressed on the way - so this ' +
    'proves nothing about auto-advance',
  ).toBe(0);

  await expect(host.locator('.champion-card')).toBeVisible();

  // ── The full bracket, over a field that produced a BYE ─────────────────────
  const bracket = await host.evaluate(() => {
    const svg = document.querySelector('.bracket-scroll svg');
    if (!svg) return null;
    const finite = (v: string | null) => Number.isFinite(parseFloat(v ?? ''));
    const lines = [...svg.querySelectorAll('line')];
    const rects = [...svg.querySelectorAll('rect')];
    const positions = rects.map(r => `${r.getAttribute('x')},${r.getAttribute('y')}`);
    return {
      boxes: rects.length,
      lines: lines.length,
      badLines: lines.filter(l => !['x1', 'y1', 'x2', 'y2'].every(a => finite(l.getAttribute(a)))).length,
      badBoxes: rects.filter(r => !['x', 'y', 'width', 'height'].every(a => finite(r.getAttribute(a)))).length,
      stacked: positions.length - new Set(positions).size,
      height: parseFloat(svg.getAttribute('height') ?? ''),
      width: parseFloat(svg.getAttribute('width') ?? ''),
      text: [...svg.querySelectorAll('text')].map(t => t.textContent ?? ''),
    };
  });

  expect(bracket, 'the champion screen painted no bracket at all').not.toBeNull();
  expect(bracket!.boxes, 'the full bracket should show every matchup of every round')
    .toBeGreaterThan(0);
  expect(bracket!.text, 'an odd book has to produce a BYE, or none of the rest of this is a test')
    .toContain('BYE');

  // Every coordinate finite. A single feeder makes the mean of an empty set on
  // the wrong branch, and NaN in an SVG attribute draws NOTHING - no error, no
  // warning, just a connector that is not there.
  expect(bracket!.badLines, 'a connector carries a non-finite coordinate').toBe(0);
  expect(bracket!.badBoxes, 'a box carries a non-finite coordinate').toBe(0);
  expect(Number.isFinite(bracket!.height) && Number.isFinite(bracket!.width)).toBe(true);

  // And no two boxes at the same point. This is the defect itself rather than
  // its NaN cousin: a solo box landing on top of its neighbour is perfectly
  // finite, renders without complaint, and hides a matchup completely.
  expect(
    bracket!.stacked,
    'two bracket boxes were drawn at the same coordinates, so one is hidden underneath the other',
  ).toBe(0);
});
