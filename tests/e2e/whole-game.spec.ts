import { test, expect } from './fixtures/game';
import { parseQuotebook } from '@/lib/parseQuotes';

/**
 * A whole game, host and three players, paste to champion (R14, U7).
 *
 * This one test replaces the whole-game half of four bespoke drivers -
 * `_pw_slideshow.js`, `_pw_v050.js`, `_pw_winscreen.js` and `_pw_voting.js` -
 * and it is ONE test on purpose. Room creation is rate limited to ten per hour
 * per IP in application code and every request this suite makes keys to the same
 * `'unknown'` IP, so a room is a budgeted resource: `_pw_v050.js` and
 * `_pw_winscreen.js` both say "ONE room create for the whole pass" at the top.
 * Splitting this into six tests would cost six rooms and six full builds of the
 * same game to reach the same screens.
 *
 * ── The book ────────────────────────────────────────────────────────────────
 *
 * Every risky parser shape the vault names, because the "author shows in the
 * bracket" report is a PARSER outcome. `_pw_winscreen.js` learned that the hard
 * way: the driver before it posted pre-structured quote objects to
 * `/api/game/create` and so could never reproduce the bug at all. The fixture
 * pastes this text into `#quotebook-text` and lets the real control parse it,
 * which is the only path that can.
 *
 * Eight quotes make rounds of 4 / 2 / 1, so a champion is three rounds away.
 */
const RISKY_BOOK = [
  'Jack: "Because of consent?" Max:"Myth."',
  '"That truck kisses his father on the lips" jeron',
  'Jon: What exactly is this proving out?',
  '"I have one rule: never lie" - Corbin',
  'The unexamined life is not worth living',
  'Corbin: "One." Jeron: "Two." Jon: "Three."',
  '"A man who carries a cat by the tail learns something" - Twain',
  'Supercalifragilisticexpialidociousandthensomemoreletters - Mary',
].join('\n');

test.use({
  gameOptions: { players: ['Ana', 'Ben', 'Cara'], quotebook: RISKY_BOOK },
});

test('a whole game runs from a pasted quotebook to a champion', async ({ game }) => {
  // Three rounds, three players and up to four matchups each: the default
  // 120 s is a budget for a test, not for a game. Every assertion inside still
  // fails in 10 s, so a missing element does not sit here burning the whole
  // allowance.
  test.setTimeout(360_000);

  const host = game.host;
  const [ana] = game.players;

  // ── Lobby ─────────────────────────────────────────────────────────────────
  // The room code breathes while the room is waiting, and every roster chip
  // carries its entrance. The chips are keyed on the player's NAME rather than
  // on an index, so an existing chip does not replay its pop on every 2 s poll
  // tick - a count of three popped chips is what says the keying still holds.
  await expect(host.locator('.host-room-code.is-waiting')).toBeVisible();
  await expect(host.locator('.chip.m-pop')).toHaveCount(3);

  await game.startGame();

  // ── Round 1, voting ───────────────────────────────────────────────────────
  await expect(host.locator('.m-rise')).not.toHaveCount(0);
  await expect(host.locator('.bracket-active')).not.toHaveCount(0);
  // Eight quotes, so four matchups. Asserted because a vote loop that exits on
  // a transiently disabled button casts ONE vote and reports the round finished
  // (KTD7), and nothing distinguishes that from success unless someone counts.
  await expect(ana.page.locator('.match-header')).toContainText('of 4');
  await expect(ana.page.locator('.stage-fade')).toBeVisible();

  await game.voteRound();
  for (const player of game.players) {
    await expect(
      player.page.locator('.alert-success'),
      `${player.name} did not get through every matchup of round 1`,
    ).toBeVisible();
  }

  // ── KTD9: the recap covers the results, so the results must not move yet ───
  //
  // `/advance` sets `status='results'` and mounts `ResultsSlideshow` in the same
  // commit. The slideshow is `position: fixed; inset: 0; z-index: 900` over an
  // opaque background, and runs for up to ~9 s on an eight-matchup round.
  // Anything the results screen animates on ARRIVAL therefore plays to
  // completion behind an opaque overlay and is never seen by anybody. The host
  // page keys the reveal off the slideshow finishing instead, and this is the
  // assertion that says so.
  await game.showRecap();
  await expect(host.locator('.slideshow')).toBeVisible();
  expect(
    await host.locator('.result-row.m-resolve').count(),
    'a result row was already resolving while the slideshow covered the screen (KTD9) - that ' +
    'motion runs to completion behind an opaque overlay and nobody ever sees it',
  ).toBe(0);

  // The recap is the host's screen alone. A player looking at their phone gets
  // their own stage, not a second copy of the presentation.
  expect(await ana.page.locator('.slideshow').count()).toBe(0);
  // And the recap never names an author: `QuoteCard`'s `showAuthor` defaults to
  // false, and the reveal is the champion card's job. A leak here would give the
  // room the answer one round early.
  expect(await host.locator('.slideshow .quote-author').count()).toBe(0);

  // Space skips it, and neither scrolls the page down nor presses the control
  // the host has just clicked and which still holds focus. The handler is on the
  // window in CAPTURE phase and preventDefaults on both keydown and keyup, which
  // is what buys those two.
  //
  // NOT asserted as "the scroll position is unchanged", which is what
  // `_pw_slideshow.js` logged. Measured: the recap unmounting swaps the voting
  // screen for the results screen underneath it, the document gets shorter, and
  // the browser legitimately lands the page back at the top - 26 to 0 on this
  // book. That is the layout changing, not Space scrolling. Space's own default
  // is DOWNWARD, so downward is what this looks for.
  const scrollBefore = await host.evaluate(() => window.scrollY);
  await game.skipSlideshow();
  expect(
    await host.evaluate(() => window.scrollY),
    'Space skipped the recap and scrolled the page down - the keydown half of the handler is not ' +
    'preventDefaulting',
  ).toBeLessThanOrEqual(scrollBefore);

  // ── The motion the slideshow was holding back, now that it has ended ───────
  await expect(host.locator('.result-row.m-resolve')).not.toHaveCount(0);
  await expect(host.locator('.bracket-enter')).not.toHaveCount(0);

  // And the round did not start itself. The forward control was focused when
  // Space arrived; without the keyup half of the handler that keystroke
  // activates it, and the host is thrown into round 2 having never seen the
  // results they asked for.
  await expect(host.locator('.round-header .btn-primary')).toContainText('Start Round 2');

  // ── Rounds 2 and 3 ────────────────────────────────────────────────────────
  let rounds = 1;
  while (!(await game.isOver())) {
    await game.startNextRound();
    await game.voteRound();
    await game.showResults();
    rounds++;
    expect(rounds, 'eight quotes should resolve in three rounds').toBeLessThanOrEqual(3);
  }
  expect(rounds).toBe(3);

  // ── The champion screen ───────────────────────────────────────────────────
  await expect(host.locator('.champion-card.win-card')).toBeVisible();
  await expect(host.locator('.champion-quote')).not.toBeEmpty();
  // Both rankings panels, and bars that carry their fill class. Host-only: the
  // popularity table needs the raw voter names, which only the host's response
  // carries.
  await expect(host.locator('.rank-panel.win-panel')).toHaveCount(2);
  await expect(host.locator('.rank-bar-fill.win-bar')).not.toHaveCount(0);
  // The coffee card is full width on the end screen, on the host AND on the
  // player - it was a narrow card wedged into a corner on one of them.
  await expect(host.locator('.bmc-card-full')).toHaveCount(1);

  const player = ana.page;
  await expect(player.locator('.champion-card')).toBeVisible({ timeout: 30_000 });
  await expect(player.locator('.player-recap')).toHaveCount(1);
  await expect(player.locator('.bmc-card-full')).toHaveCount(1);

  // ── The bug `_pw_winscreen.js` was written to catch ────────────────────────
  //
  // A bracket cell renders `truncate(quote.text, 22)`. If the parser leaves a
  // speaker's name inside `text` instead of lifting it into `author`, the
  // bracket shows "Jack:" to a room whose whole game is guessing who said what.
  // The check is on the SVG's painted text nodes, which is where a reader would
  // see it, and the authors come from running the same parser over the same
  // book rather than from a hand-written list that could drift from it.
  const quotes = parseQuotebook(RISKY_BOOK);
  const authors = [
    ...new Set(
      quotes.flatMap(q =>
        String(q.author).split(',').map(s => s.trim()).filter(a => a && a !== 'Unknown'),
      ),
    ),
  ];
  expect(authors.length, 'the book should parse to some named authors, or this proves nothing')
    .toBeGreaterThan(0);

  const cells = await host.locator('.bracket-scroll text').allTextContents();
  expect(cells.length, 'the full bracket should paint some text').toBeGreaterThan(0);
  const leaks = cells.filter(cell =>
    authors.some(
      author =>
        new RegExp(`(^|[^A-Za-z])${author}\\s*:`, 'i').test(cell) ||
        new RegExp(`(^|[^A-Za-z])${author}$`, 'i').test(cell.trim()),
    ),
  );
  expect(
    leaks,
    `a bracket cell names an author. Checked ${authors.join(', ')} against ${cells.length} ` +
    'painted cells. This is a PARSER outcome - the speaker was left inside `text` instead of ' +
    'being lifted into `author` - so it can only ever be reproduced through the real quotebook ' +
    'control, which is how the fixture creates its room.',
  ).toEqual([]);

  // ── AE1: the same screen under reduced motion ─────────────────────────────
  //
  // A second host page, loaded WITH the preference set rather than toggled after
  // the fact, because an entrance is only observable while it plays. The game
  // itself was played under normal motion, which is the only way there is a
  // champion screen here to load.
  const reduced = await game.openHostView({ reducedMotion: 'reduce' });
  await expect(reduced.locator('.champion-card')).toBeVisible({ timeout: 30_000 });
  const still = await reduced.evaluate(() => {
    const bars = [...document.querySelectorAll('.rank-bar-fill')];
    const card = document.querySelector('.champion-card');
    return {
      panels: document.querySelectorAll('.rank-panel').length,
      bars: bars.length,
      animatedBars: bars.filter(b => getComputedStyle(b).animationName !== 'none').length,
      sized: bars.every(b => parseFloat(getComputedStyle(b).width) >= 0),
      cardAnimation: card ? getComputedStyle(card).animationName : 'no card',
      canvases: document.querySelectorAll('canvas').length,
    };
  });
  expect(still.panels, 'reduced motion should remove the motion, never the content').toBe(2);
  expect(still.bars).toBeGreaterThan(0);
  expect(still.animatedBars, 'a rate bar still animates under reduced motion').toBe(0);
  expect(still.sized, 'the bars must still be drawn at their value, just not grow into it').toBe(true);
  expect(still.cardAnimation).toBe('none');
  // The one that CSS cannot do. `Confetti` draws to a canvas from script, so no
  // `prefers-reduced-motion` rule in globals.css can suppress it; the component
  // checks `matchMedia` at the callsite and returns before creating anything.
  expect(
    still.canvases,
    'the celebration fired under reduced motion. No stylesheet can stop it - the check has to be ' +
    'the `prefersReducedMotion()` call inside Confetti.tsx',
  ).toBe(0);
});
