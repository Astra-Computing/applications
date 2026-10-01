import { test, expect } from './fixtures/guards';

/**
 * The host setup screen, ported from `_pw_v050.js` (U7, R14).
 *
 * These are the checks that come BEFORE a room exists, and they are here in a
 * file of their own for one reason: none of them needs a game. Room creation is
 * rate limited to ten per hour per IP by application code
 * (`src/lib/rateLimit.ts`) and every test in this suite keys to the same
 * `'unknown'` IP, so a spec that takes a room it does not use is spending a
 * scarce thing. `_pw_v050.js` had the same budget and said so at the top of the
 * file - "ONE room create for the whole pass".
 *
 * No game fixture, so `test` comes from `./fixtures/guards`. The standing CSP
 * guard covers these pages anyway; it hooks `context.on('page')` rather than a
 * page the fixture built (KTD5, R20).
 */

/** Deliberately mixed shapes, fed through the real control so the parser runs
 *  exactly the way it will for a host. Carried over from `_pw_v050.js`. */
const QUOTEBOOK = [
  '"The bracket is the message" - Marshall',
  '"I have one rule: never lie" — Corbin',
  'Jack: "Because of consent?" Max:"Myth."',
  '"That truck kisses his father on the lips" jeron',
  'Jon: What exactly is this proving out?',
  '"A still wave is shape, not motion"',
  'The room code is not a secret - Ana',
  '"Ship it and see" — Ben',
].join('\n');

test('a pasted quotebook parses, and the create action unlocks only above the minimum', async ({
  page,
}) => {
  await page.goto('/host');

  const count = page.locator('.qb-count');
  const create = page.getByRole('button', { name: 'Create Game' });

  // One line. The interesting part is that the count reports 1 rather than 0:
  // a sub-minimum parse clears the parsed quotes, so a count derived from those
  // would tell the host their line was not read at all when it was.
  await page.fill('#quotebook-text', 'Just the one line here');
  await expect(count).toContainText('1 quote', { timeout: 10_000 });
  // Present AND disabled, not absent. The control used to be mounted only once
  // it was usable, which leaves "you cannot start yet" as something the host has
  // to infer from an empty space.
  await expect(create).toBeVisible();
  await expect(create).toBeDisabled();
  await expect(page.locator('.alert-error')).toContainText('at least 2');

  // The full book. `.qb-count` runs through `useAnimatedNumber`, so it climbs to
  // its value rather than jumping - which is why this is a polled assertion and
  // not a single read. `_pw_v050.js` slept 900 ms here instead.
  await page.fill('#quotebook-text', QUOTEBOOK);
  await expect(count).toContainText('8 quotes', { timeout: 10_000 });
  await expect(create).toBeEnabled();

  // Every preview row carries the stagger class. Asserted because the entrance
  // is keyed on quote CONTENT rather than on index: with `key={i}` React reuses
  // the same nodes across a second parse and the entrance silently never
  // replays, which looks identical to a working screen on the first paste.
  const rows = page.locator('.qb-preview-row');
  await expect(rows).toHaveCount(8);
  await expect(page.locator('.qb-preview-row.m-rise')).toHaveCount(8);
});

test('dragging a file over the page lights the drop target', async ({ page }) => {
  await page.goto('/host');
  await expect(page.locator('#quotebook-text')).toBeVisible();

  // Synthesising a real `DataTransfer` is the only way to exercise this: the
  // listeners are on the WINDOW, not on the box, and every one of them returns
  // early unless `dataTransfer.types` includes 'Files'. Playwright's
  // `dragTo`/mouse APIs never produce that.
  //
  // The window is where they live because dragenter and dragleave fire for
  // every descendant, so a handler bound to the box flickers the highlight off
  // each time the pointer crosses a child.
  const dispatch = (type: 'dragenter' | 'dragleave') =>
    page.evaluate(eventType => {
      const dt = new DataTransfer();
      dt.items.add(new File(['"dropped" - Someone\n"second" - Else'], 'qb.txt', { type: 'text/plain' }));
      window.dispatchEvent(new DragEvent(eventType, { dataTransfer: dt, bubbles: true }));
    }, type);

  await dispatch('dragenter');
  await expect(page.locator('.file-upload.is-dragging')).toBeVisible();

  await dispatch('dragleave');
  await expect(page.locator('.file-upload.is-dragging')).toHaveCount(0);
});

test('both quotebook controls are reachable by keyboard', async ({ page }) => {
  await page.goto('/host');

  /**
   * Focus is MOVED and then read back, rather than an attribute being checked.
   * An element can look focusable in the markup and still refuse focus -
   * `display: none` being the case that actually happened here, when the file
   * picker was a click-only div and a keyboard-only host could not create a game
   * at all. `_pw_v050.js` asserted on `activeElement` for the same reason, and
   * noted that the focus outline cannot be used: it lights up for either
   * control, so it cannot tell them apart.
   */
  const takesFocus = (selector: string) =>
    page.evaluate(sel => {
      const el = document.querySelector<HTMLElement>(sel);
      el?.focus();
      return !!el && document.activeElement === el;
    }, selector);

  expect(await takesFocus('#quotebook-text'), 'the textarea should take focus').toBe(true);
  expect(
    await takesFocus('#quotebook'),
    'the file input should take focus - if it does not, it is display:none again and no ' +
    'keyboard-only host can pick a file',
  ).toBe(true);

  // The textarea carries its own accessible name. Wrapping both controls in one
  // `<label>` would have given the name to the file input and left the textarea
  // with none - and forwarded a click on the box's padding to the file picker,
  // so a host trying to type would get an OS file dialog.
  await expect(page.locator('#quotebook-text')).toHaveAttribute('aria-label', /quotebook/i);
});
