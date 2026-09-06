import { test, expect } from './fixtures/game';
import { connect, roomExists } from '../support/db';

/**
 * The game fixture's own tests (R15, R16, AE2).
 *
 * Not game coverage - the real whole-game flows are U7. What is proved here is
 * that the fixture builds a room, that its vote loop works through a whole round
 * rather than stopping at the first transiently disabled button, and that the
 * room is deleted even when the test that owns it throws.
 */

test.use({ gameOptions: { players: ['Ana', 'Ben'] } });

test('the fixture hands over a started room with every player joined', async ({ game }) => {
  expect(game.code).toMatch(/^[A-Z]{4}$/);
  expect(game.players).toHaveLength(2);

  const sql = connect();
  try {
    expect(await roomExists(sql, game.code), 'the room should exist while the test runs').toBe(true);
  } finally {
    await sql.end();
  }

  await game.startGame();

  // Four quotes make two matchups in round 1. The point of asserting on the
  // count is that a vote loop which exits on a disabled button casts exactly
  // one vote and calls the round finished - the defect KTD7 records - and that
  // is indistinguishable from success unless someone counts.
  await expect(game.players[0].page.locator('.match-header')).toContainText('of 2');

  await game.voteRound();

  for (const player of game.players) {
    await expect(
      player.page.locator('.alert-success'),
      `${player.name} did not get through every matchup of the round`,
    ).toBeVisible();
  }

  // Both players voted every matchup, so the host's forward control unlocks.
  await expect(game.host.locator('.round-header .btn-primary')).toBeEnabled();
});

/**
 * AE2, in two halves.
 *
 * The first test is EXPECTED to fail: it takes a room and throws, which is the
 * situation R15 is about - a browser session that is gone, a host token that may
 * never have been stored, and an API route that could not be called even if
 * someone wanted to. `test.fail()` keeps the run green while the failure is
 * real, so this cannot quietly stop throwing.
 *
 * The second test asks the database directly whether the room survived. Both
 * tests are in one file on purpose: workers are pinned to 1 and
 * `fullyParallel` is false, so they run in order in the same process.
 */
let abandonedRoom = '';

test('a test that creates a room and throws', async ({ game }) => {
  test.fail(true, 'throws on purpose so the next test can prove the teardown still ran (AE2)');
  abandonedRoom = game.code;

  const sql = connect();
  try {
    expect(await roomExists(sql, abandonedRoom)).toBe(true);
  } finally {
    await sql.end();
  }

  throw new Error(`deliberate failure while holding room ${abandonedRoom}`);
});

test('leaves no room behind', async () => {
  expect(abandonedRoom, 'the previous test never got as far as creating a room').toMatch(
    /^[A-Z]{4}$/,
  );

  const sql = connect();
  try {
    expect(
      await roomExists(sql, abandonedRoom),
      `room ${abandonedRoom} outlived the test that threw - teardown is not unconditional (R15)`,
    ).toBe(false);
  } finally {
    await sql.end();
  }
});
