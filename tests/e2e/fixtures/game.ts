import { expect, type BrowserContext, type Page } from '@playwright/test';
import { test as guarded, type CspGuard } from './guards';
import { connect, deleteRoom } from '../../support/db';

/**
 * The game fixture: every browser test gets a room it did not build, and
 * cleanup it cannot forget.
 *
 * Two things live here and nowhere else.
 *
 * ── Cleanup that survives a thrown test (R15, AE2) ──────────────────────────
 *
 * The room is deleted in teardown UNCONDITIONALLY, and through
 * `tests/support/db.ts` rather than `POST /api/game/<code>/end`. The API route
 * needs the host token out of the host page's localStorage, and the failures
 * worth cleaning up after are exactly the ones where that page is gone, the
 * context is closed, or the token was never stored. A direct DELETE on the test
 * database depends on none of it, so a test that throws mid-game leaves nothing
 * behind. Teardown is wrapped so a failure while closing browser contexts
 * cannot skip the delete either.
 *
 * ── The driver knowledge, expressed once (R16, KTD7) ────────────────────────
 *
 * Seven bespoke driver scripts each re-discovered these, and each cost hours:
 *
 *  - The join form's fields are `#code` and `#name`, filled by id. There is no
 *    stable accessible name to go by.
 *  - `#skip-tutorial` must be TICKED BEFORE "Start Game". The How-to-Play
 *    overlay opens on a successful start, is `position: fixed` over the whole
 *    page, and intercepts every later click - the host appears frozen and the
 *    real cause is one modal nobody dismissed.
 *  - The vote loop is driven by WHETHER A MATCHUP IS ON SCREEN, never by
 *    whether a vote button is enabled. Those buttons are disabled twice per
 *    vote: once while the request is in flight, and again for the 200 ms
 *    confirmation hold in `CONFIRM_HOLD_MS`. A loop that exits on "no enabled
 *    button" stops after the first vote and reports a round as complete when
 *    one matchup of four was cast.
 */

/** The default book: four quotes, so a game reaches a champion in two rounds. */
export const DEFAULT_QUOTEBOOK = [
  '"The bracket is the message" - Marshall',
  '"A still wave is shape, not motion" - Ana',
  '"Consent is the whole game" - Cara',
  '"The BYE is not a prize" - Fay',
].join('\n');

export type GameOptions = {
  /** Player names. One page and one browser context per name. */
  players: string[];
  /** Quotebook text, pasted into `#quotebook-text` exactly as a host would. */
  quotebook: string;
  /** Host viewport. Players always get a phone-sized one. */
  hostViewport: { width: number; height: number };
};

export type GamePlayer = {
  name: string;
  page: Page;
  context: BrowserContext;
};

export type Game = {
  /** The room code, known as soon as the host lands on /room/<CODE>/host. */
  readonly code: string;
  /** The host's page, already on the room's host screen. */
  readonly host: Page;
  /** One per requested name, each already on the room's player screen. */
  readonly players: readonly GamePlayer[];

  /** Ticks "Skip tutorial", presses Start Game, waits for round 1 voting. */
  startGame(): Promise<void>;
  /** Every player votes every matchup of the round currently on screen. */
  voteRound(): Promise<void>;
  /** Host presses Show Results, then skips the recap slideshow. */
  showResults(): Promise<void>;
  /** Host presses Start Round N. */
  startNextRound(): Promise<void>;
  /** True once the host header reads "Game Over". */
  isOver(): Promise<boolean>;
  /** Start, then play whole rounds until a champion. Returns the round count. */
  playToChampion(): Promise<number>;
};

type Fixtures = {
  /**
   * Partial on purpose. `test.use` REPLACES an option rather than merging into
   * it, so a file naming only `players` would otherwise silently drop the
   * quotebook and the host viewport. The defaults are re-applied in the fixture
   * body instead, where they cannot be lost.
   */
  gameOptions: Partial<GameOptions>;
  game: Game;
};

const PLAYER_VIEWPORT = { width: 390, height: 844 };

/**
 * How long one player is given to work through every matchup of one round.
 *
 * Generous because it spans the player's own 2 s poll landing the new round,
 * plus one request and one 200 ms hold per matchup. It is a deadline for the
 * whole loop, never a reason to leave it early.
 */
const ROUND_MS = 90_000;

/** How long the host is given for a phase change the server has to confirm. */
const PHASE_MS = 60_000;

export const test = guarded.extend<Fixtures>({
  /**
   * Per-file overrides, e.g.
   *   test.use({ gameOptions: { players: ['Ana', 'Ben'] } });
   * Merged over the defaults, so a file names only what it cares about.
   */
  gameOptions: [
    { players: ['Ana'], quotebook: DEFAULT_QUOTEBOOK, hostViewport: { width: 1440, height: 900 } },
    { option: true },
  ],

  game: async ({ browser, gameOptions, cspGuard }, use) => {
    const options: GameOptions = {
      players: gameOptions.players ?? ['Ana'],
      quotebook: gameOptions.quotebook ?? DEFAULT_QUOTEBOOK,
      hostViewport: gameOptions.hostViewport ?? { width: 1440, height: 900 },
    };

    const contexts: BrowserContext[] = [];
    const open = async (viewport: { width: number; height: number }): Promise<Page> => {
      const context = await browser.newContext({ viewport });
      contexts.push(context);
      // Every context this fixture makes is registered with the standing CSP
      // guard, not only the one Playwright hands out (KTD5, R20).
      await cspGuard.watch(context);
      return context.newPage();
    };

    const host = await open(options.hostViewport);
    // Created through the interface rather than through POST /api/game/create,
    // so the fixture exercises the same path a host does - including the
    // in-browser parse of the quotebook, which is where a room can fail to
    // exist at all.
    await host.goto('/host');
    await host.fill('#quotebook-text', options.quotebook);
    await expect(host.getByRole('button', { name: 'Create Game' })).toBeEnabled();
    await host.getByRole('button', { name: 'Create Game' }).click();
    await host.waitForURL(/\/room\/[A-Z]+\/host/, { timeout: PHASE_MS });

    const code = host.url().match(/\/room\/([A-Z]+)\//)![1];

    // From here everything is inside the try, so a failure while players join
    // still deletes the room the host just created (R15, AE2).
    try {
      const players: GamePlayer[] = [];
      for (const name of options.players) {
        const page = await open(PLAYER_VIEWPORT);
        await page.goto(`/join?code=${code}`);
        // By id. The two inputs carry no accessible name that survives a copy
        // edit, and every driver that guessed at one broke.
        await page.fill('#code', code);
        await page.fill('#name', name);
        // By type, not by name: the label is "Join →", an arrow one copy edit
        // away from breaking every driver that matched on it.
        await page.click('form button[type="submit"]');
        await page.waitForURL(/\/room\/[A-Z]+\/player/, { timeout: PHASE_MS });
        players.push({ name, page, context: page.context() });
      }

      // The host's roster is filled by its own 2 s poll, so a Start Game press
      // before it lands hits a disabled button.
      await expect(host.locator('.chip-kick')).toHaveCount(players.length, { timeout: PHASE_MS });

      const game = makeGame(code, host, players);
      await use(game);
    } finally {
      // Close first so nothing is still polling a room about to vanish, but
      // never let a close failure skip the delete.
      for (const context of contexts) {
        await context.close().catch(() => {});
      }
      const sql = connect();
      try {
        await deleteRoom(sql, code);
      } finally {
        await sql.end();
      }
    }
  },
});

export { expect } from './guards';

// ── The flow, in one place ──────────────────────────────────────────────────

function makeGame(code: string, host: Page, players: GamePlayer[]): Game {
  const headerButton = host.locator('.round-header .btn-primary');
  const slideshow = host.locator('.slideshow');

  const isOver = async () =>
    (await host.locator('.round-header-title', { hasText: 'Game Over' }).count()) > 0;

  const startGame = async () => {
    // BEFORE Start Game, not after. The How-to-Play overlay opens on a
    // successful start and covers the page; every click after it lands on the
    // overlay instead of the control it aimed at.
    await host.check('#skip-tutorial');
    await host.getByRole('button', { name: /Start Game/ }).click();
    await expect(host.locator('.round-header-title')).toContainText('Round 1', { timeout: PHASE_MS });
  };

  /** Which round the host is showing, read from "Round N of M". */
  const currentRound = async (): Promise<number> => {
    const title = await host.locator('.round-header-title').innerText();
    const match = title.match(/Round (\d+)/);
    if (!match) throw new Error(`The host header does not name a round: "${title}"`);
    return Number(match[1]);
  };

  const voteRound = async () => {
    const round = await currentRound();
    for (const player of players) await voteThroughRound(player, round);
  };

  const showResults = async () => {
    await expect(headerButton).toContainText('Show Results', { timeout: PHASE_MS });
    await expect(headerButton).toBeEnabled({ timeout: PHASE_MS });
    await headerButton.click();
    // The recap is up to ~9 s of slideshow. Space skips it - the handler is on
    // the window in capture phase and preventDefaults, so nothing else sees it.
    await slideshow.waitFor({ state: 'attached', timeout: PHASE_MS }).catch(() => {});
    while ((await slideshow.count()) > 0) {
      await host.keyboard.press('Space');
      await slideshow.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
    }
  };

  const startNextRound = async () => {
    await expect(headerButton).toContainText('Start Round', { timeout: PHASE_MS });
    await expect(headerButton).toBeEnabled({ timeout: PHASE_MS });
    await headerButton.click();
  };

  const playToChampion = async () => {
    await startGame();
    let rounds = 0;
    // A bracket over any book this suite would paste is far below this.
    for (let i = 0; i < 12; i++) {
      if (await isOver()) return rounds;
      await voteRound();
      await showResults();
      rounds++;
      if (await isOver()) return rounds;
      await startNextRound();
    }
    throw new Error(`The game never reached a champion after ${rounds} rounds.`);
  };

  return { code, host, players, startGame, voteRound, showResults, startNextRound, isOver, playToChampion };
}

/**
 * Casts this player's vote on every matchup of round `round`.
 *
 * Two pieces of hard-won knowledge, both of which produce a silent false pass
 * when they are missing.
 *
 * First, the wait for the round to arrive. The host starts round N the instant
 * it presses the button; this player learns about it on its own 2 s poll, and
 * until then the screen still shows round N-1's "All votes cast! Waiting for
 * host." banner. A loop that starts by looking for that banner sees it, decides
 * the round is finished and returns having cast nothing - and the failure lands
 * far away, on the host's forward button never unlocking. Measured, not
 * theorised: that is exactly how this fixture failed its first run.
 *
 * Second, the loop condition is the PRESENCE OF A MATCHUP, never the enabled
 * state of a button (KTD7). Vote buttons are disabled twice per vote - while the
 * request is in flight, and again for the 200 ms confirmation hold - so a loop
 * that exits on "no enabled button" stops after one vote and reports a
 * four-matchup round as complete.
 */
async function voteThroughRound({ name, page }: GamePlayer, round: number): Promise<void> {
  const matchup = page.locator('.player-matchup');
  const allCast = page.locator('.alert-success');
  const votingHeading = page.locator('h3', { hasText: 'Vote!' });

  await page
    .waitForFunction(
      n =>
        [...document.querySelectorAll('h3')].some(h => (h.textContent ?? '').includes(`Round ${n}`)) &&
        !!document.querySelector('.player-matchup .match-header'),
      round,
      { timeout: ROUND_MS },
    )
    .catch(() => {
      throw new Error(
        `${name} never received round ${round}. The player polls every 2s, so this is either a ` +
        'stalled poll or a round the server never started.',
      );
    });

  const deadline = Date.now() + ROUND_MS;
  let cast = 0;

  while (Date.now() < deadline) {
    if ((await allCast.count()) > 0) return;
    if ((await matchup.count()) === 0) {
      // Nothing to vote on yet. Either this player's own 2 s poll has not
      // landed the round, or the host has already moved past it.
      if ((await votingHeading.count()) === 0) return;
      await page.waitForTimeout(200);
      continue;
    }

    // `textContent`, NOT `innerText`, and this is measured rather than
    // stylistic. `.match-header` is `text-transform: uppercase`, so `innerText`
    // returns the RENDERED "MATCHUP 1 OF 2" while the `textContent` read inside
    // the page below returns "Matchup 1 of 2". Comparing one against the other
    // never matches, the wait returns instantly every time, and the loop
    // re-votes the same matchup as fast as it can click - ten times on a
    // one-matchup round, before eventually stalling. Every symptom of that reads
    // as a flaky server rather than as a case mismatch in the test.
    const header = await matchup.locator('.match-header').textContent().catch(() => '');
    // `click` auto-waits for the button to become enabled, which is what makes
    // the in-flight disable and the 200 ms confirmation hold a pause rather than
    // an exit. A miss here is retried by the next turn of the loop, because the
    // matchup is still on screen.
    await matchup.locator('button').first().click({ timeout: 15_000 }).catch(() => {});
    cast++;

    // Wait for the board to actually move on, so the next turn does not vote
    // twice on the same matchup.
    await page
      .waitForFunction(
        previous => {
          const current = document.querySelector('.match-header');
          return (
            (!!current && current.textContent !== previous) ||
            !!document.querySelector('.alert-success') ||
            !document.querySelector('.player-matchup')
          );
        },
        header,
        { timeout: 20_000 },
      )
      .catch(() => {});
  }

  throw new Error(
    `${name} did not finish the round within ${ROUND_MS}ms after ${cast} vote attempt(s). ` +
    'The matchup was still on screen, so this is a stuck round rather than a finished one.',
  );
}

// ── R26: the celebration is asserted to have DRAWN something ────────────────

/**
 * Fails unless the champion celebration actually put pixels on the screen.
 *
 * "A canvas exists" is not evidence, and that is not a hypothetical: the
 * fireworks were dead on every deployed build for two releases while a canvas
 * was present, sized, visible, opacity 1 and at z-index 100, and two separate
 * verification passes asserted exactly that and both passed. The worker drawing
 * into it had been killed by CSP, silently.
 *
 * The read is a SCREENSHOT, not `getContext`. canvas-confetti calls
 * `transferControlToOffscreen` on its canvas, after which `getContext('2d')` on
 * that element throws `InvalidStateError` - an in-page pixel read cannot work at
 * all. Playwright screenshots capture composited browser output and are
 * unaffected. There is no baseline image anywhere in this (KTD6).
 *
 * The signal is LIVENESS: the same strip captured repeatedly during the burst,
 * and at least two captures must differ. "Not a uniform colour" was tried first
 * and measured, and it is wrong for the player: at 390px the 3% page padding is
 * 11px, card borders and their antialiasing sit right at that edge, and the
 * strip carries 10-28 distinct colours whether or not a single particle is
 * drawn. It would have passed a completely dead celebration on a phone, which is
 * the same class of false pass this whole file exists to end. Two identical
 * captures, by contrast, mean nothing moved - and confetti is nothing but
 * movement.
 *
 * The strip is the outer gutter, below the animated top banner: `.page` is
 * full-width with `padding: 2rem 3%`, so a strip narrower than 3% of the
 * viewport holds no page content of its own, and every infinite CSS animation in
 * globals.css (the banner waves, `bracket-pulse`, `gold-breathe`, the shimmers)
 * is either above it or inside the content column. The confetti canvas is
 * `position: fixed` over the full viewport at z-index 100, so particles cross it
 * freely.
 */
export async function expectCelebrationDrew(page: Page, label: string): Promise<void> {
  const canvas = page.locator('canvas');
  await expect(canvas, `${label}: canvas-confetti never created a canvas`).toHaveCount(1, {
    timeout: 15_000,
  });

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('expectCelebrationDrew needs a page with a viewport');
  // Screenshot clips are page coordinates and the confetti canvas is
  // `position: fixed`; pinning the scroll to the top makes the two the same.
  await page.evaluate(() => window.scrollTo(0, 0));
  // `.win-card`'s entrance is 0.55s and finite. Letting it finish keeps this
  // assertion about the celebration rather than about the card sliding in.
  await page.waitForTimeout(700);

  const clip = {
    x: 0,
    y: Math.round(viewport.height * 0.35),
    width: Math.max(6, Math.round(viewport.width * 0.028)),
    height: Math.round(viewport.height * 0.6),
  };

  // The opening volley plus the 6s shower give roughly a 7s window from mount.
  // Sampling stops the moment two captures disagree.
  const deadline = Date.now() + 6_000;
  const seen = new Map<string, number>();
  const colours: number[] = [];
  while (Date.now() < deadline) {
    const shot = await page.screenshot({ clip, animations: 'allow', caret: 'initial' });
    const sample = await fingerprint(page, shot);
    colours.push(sample.colours);
    seen.set(sample.hash, (seen.get(sample.hash) ?? 0) + 1);
    if (seen.size > 1) return;
  }

  expect(
    seen.size,
    `${label}: the celebration drew nothing. The ${clip.width}x${clip.height} strip at ` +
    `(${clip.x},${clip.y}) was pixel-for-pixel identical across ${colours.length} captures ` +
    'spanning the whole burst, so the canvas is present and nothing is moving in it - which is ' +
    'exactly what a CSP-blocked OffscreenCanvas worker looks like, and it is silent. Check that ' +
    'next.config.js still carries "worker-src \'self\' blob:". Distinct colours per capture: ' +
    `[${colours.join(', ')}]`,
  ).toBeGreaterThan(1);
}

/**
 * A PNG's pixel hash and distinct-colour count, computed in the page.
 *
 * In the page because nothing in this repo can decode a PNG in Node and a
 * dependency for it is not worth it. The screenshot is drawn into a FRESH
 * detached canvas, which has nothing to do with the confetti canvas - that one
 * has transferred control offscreen and cannot be read at all. `img-src` permits
 * `data:`, so the CSP guard stays quiet about this.
 *
 * Hashed rather than compared as PNG bytes: identical pixels are not guaranteed
 * to encode to identical files, and a false difference here would be a false
 * PASS, which is the one direction this assertion must never fail in.
 */
async function fingerprint(page: Page, png: Buffer): Promise<{ hash: string; colours: number }> {
  return page.evaluate(async (base64: string) => {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('could not decode the screenshot'));
      image.src = `data:image/png;base64,${base64}`;
    });
    const surface = document.createElement('canvas');
    surface.width = image.width;
    surface.height = image.height;
    const ctx = surface.getContext('2d');
    if (!ctx) throw new Error('no 2d context for the screenshot');
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, surface.width, surface.height);

    const seen = new Set<number>();
    // FNV-1a over every byte. Cheap, and collisions here would only ever hide a
    // difference, never invent one.
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i += 4) {
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      for (let c = 0; c < 3; c++) {
        hash ^= data[i + c];
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
    }
    return { hash: hash.toString(16), colours: seen.size };
  }, png.toString('base64'));
}
