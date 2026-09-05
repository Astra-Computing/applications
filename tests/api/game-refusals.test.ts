import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Sql } from 'postgres';
import { connect, applySchema, resetDatabase, countRooms } from '../support/db';
import { apiGet, apiPost, mutateRoomState } from '../support/server';
import { PLAYER_TIMEOUT_MS } from '@/lib/gameLogic';
import { getSql } from '@/lib/db';
import type { GameStatePublic, Quote } from '@/lib/types';

/**
 * The refusals, at the status codes the routes really return (R12).
 *
 * These are the assertions the browser layer cannot make. A player who votes
 * into a round the host has already resolved sees "that action is not available
 * right now" either way — whether the route answered 409, or answered 200 and
 * dropped the vote on the floor. Only this layer can tell those apart, and the
 * dropped-vote version is a bug that shipped once already.
 */

const QUOTES: Quote[] = [
  { text: 'The first quote', author: 'Ada' },
  { text: 'The second quote', author: 'Bram' },
];

/** No `expect` here: several tests deliberately want the raw response. */
async function createRoom(quotes: Quote[] = QUOTES) {
  const res = await apiPost('/api/game/create', { quotes });
  if (res.status !== 200) throw new Error(`setup failed: /create answered ${res.status}`);
  return await res.json() as { roomCode: string; hostToken: string };
}

async function join(code: string, name: string, existingToken?: string) {
  const res = await apiPost(`/api/game/${code}/join`, { name, existingToken });
  if (res.status !== 200) throw new Error(`setup failed: /join answered ${res.status}`);
  return (await res.json() as { ok: true; token: string }).token;
}

function participants(view: GameStatePublic): Record<string, number> {
  return view.participants;
}

describe('route refusals', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connect();
    await applySchema(sql);
  });

  // R6, and R2: truncating `rate_limits` too is what lets this file create far
  // more than ten rooms without the application's own cap refusing one.
  beforeEach(async () => {
    await resetDatabase(sql);
  });

  afterAll(async () => {
    await sql.end();
    // mutateRoomState below goes through the application's own lazily-created
    // client, a different pool from `sql`. An idle connection keeps the worker
    // alive after the last test.
    await getSql().end();
  });

  describe('POST /api/game/create', () => {
    it.each([
      ['fewer than two quotes', { quotes: [QUOTES[0]] }],
      ['no quotes at all', { quotes: [] }],
      ['a quotes field that is not an array', { quotes: 'nope' }],
      ['quote text over 2000 characters', { quotes: [{ text: 'x'.repeat(2001), author: 'Ada' }, QUOTES[1]] }],
      ['an author over 200 characters', { quotes: [{ text: 'ok', author: 'y'.repeat(201) }, QUOTES[1]] }],
      ['a non-string author', { quotes: [{ text: 'ok', author: 42 }, QUOTES[1]] }],
    ])('refuses %s with 400', async (_label, body) => {
      expect((await apiPost('/api/game/create', body)).status).toBe(400);
      expect(await countRooms(sql)).toBe(0);
    });

    it('refuses more than 512 quotes with 400', async () => {
      const quotes = Array.from({ length: 513 }, (_, i) => ({ text: `q${i}`, author: 'Ada' }));
      expect((await apiPost('/api/game/create', { quotes })).status).toBe(400);
    });

    // Characterization, and a discrepancy worth knowing about: /create parses
    // the body INSIDE its outer try/catch, so a malformed payload lands in the
    // generic 500 handler. Every other body-reading route (/join, /vote, /kick)
    // wraps req.json() separately and answers 400. Asserted as it is, not as it
    // arguably should be — changing it is a src/ change, not a test change.
    it('answers 500, not 400, on a malformed body', async () => {
      expect((await apiPost('/api/game/create', '{ not json')).status).toBe(500);
      expect(await countRooms(sql)).toBe(0);
    });

    // The ten-per-hour cap is application code keyed on the client IP, and no
    // test sends x-forwarded-for, so all of these share the 'unknown' key. This
    // is the cap reached through the route rather than through checkRateLimit,
    // which is what proves the route surfaces it as 429.
    it('refuses the eleventh room in an hour with 429', async () => {
      for (let i = 0; i < 10; i++) await createRoom();
      expect((await apiPost('/api/game/create', { quotes: QUOTES })).status).toBe(429);
      expect(await countRooms(sql)).toBe(10);
    });
  });

  describe('room codes and missing rooms', () => {
    // isValidCode is /^[A-Z]{4}$/ against the uppercased param, so anything
    // that is not four letters is rejected before the database is touched.
    it.each(['ABC', 'ABCDE', 'AB12'])('refuses the malformed code %s with 400', async code => {
      expect((await apiGet(`/api/game/${code}`)).status).toBe(400);
    });

    it('refuses a malformed code on every write route with 400', async () => {
      const bad = 'AB12';
      expect((await apiPost(`/api/game/${bad}/join`, { name: 'Ada' })).status).toBe(400);
      expect((await apiPost(`/api/game/${bad}/heartbeat`, undefined, { 'x-player-token': 't' })).status).toBe(400);
      expect((await apiPost(`/api/game/${bad}/vote`, { matchupIndex: 0, choice: 'a' }, { 'x-player-token': 't' })).status).toBe(400);
      expect((await apiPost(`/api/game/${bad}/start`, undefined, { 'x-host-token': 't' })).status).toBe(400);
      expect((await apiPost(`/api/game/${bad}/advance`, undefined, { 'x-host-token': 't' })).status).toBe(400);
      expect((await apiPost(`/api/game/${bad}/kick`, { name: 'Ada' }, { 'x-host-token': 't' })).status).toBe(400);
      expect((await apiPost(`/api/game/${bad}/end`, undefined, { 'x-host-token': 't' })).status).toBe(400);
    });

    // ZZZZ is a well-formed code for a room that does not exist — the table was
    // just truncated. Every route reports 404 rather than 401, including the
    // authenticated ones: the room's absence is checked before the token,
    // because the token cannot be compared against a state that isn't there.
    it('answers 404 for a well-formed code with no room behind it', async () => {
      expect((await apiGet('/api/game/ZZZZ')).status).toBe(404);
      expect((await apiPost('/api/game/ZZZZ/join', { name: 'Ada' })).status).toBe(404);
      expect((await apiPost('/api/game/ZZZZ/heartbeat', undefined, { 'x-player-token': 't' })).status).toBe(404);
      expect((await apiPost('/api/game/ZZZZ/vote', { matchupIndex: 0, choice: 'a' }, { 'x-player-token': 't' })).status).toBe(404);
      expect((await apiPost('/api/game/ZZZZ/start', undefined, { 'x-host-token': 't' })).status).toBe(404);
      expect((await apiPost('/api/game/ZZZZ/advance', undefined, { 'x-host-token': 't' })).status).toBe(404);
      expect((await apiPost('/api/game/ZZZZ/kick', { name: 'Ada' }, { 'x-host-token': 't' })).status).toBe(404);
      expect((await apiPost('/api/game/ZZZZ/end', undefined, { 'x-host-token': 't' })).status).toBe(404);
    });
  });

  describe('player token', () => {
    it('refuses a heartbeat with no token, and with a token belonging to nobody', async () => {
      const { roomCode } = await createRoom();
      await join(roomCode, 'Ada');
      expect((await apiPost(`/api/game/${roomCode}/heartbeat`)).status).toBe(401);
      expect((await apiPost(`/api/game/${roomCode}/heartbeat`, undefined, { 'x-player-token': 'not-a-token' })).status).toBe(401);
    });

    it('refuses a vote with no token, and with a token belonging to nobody', async () => {
      const { roomCode, hostToken } = await createRoom();
      await join(roomCode, 'Ada');
      await apiPost(`/api/game/${roomCode}/start`, undefined, { 'x-host-token': hostToken });
      const body = { matchupIndex: 0, choice: 'a' };
      expect((await apiPost(`/api/game/${roomCode}/vote`, body)).status).toBe(401);
      expect((await apiPost(`/api/game/${roomCode}/vote`, body, { 'x-player-token': 'not-a-token' })).status).toBe(401);
    });

    // A token from one room must not authenticate in another. The rooms share a
    // table and the same key, so nothing but the per-room token list stops it.
    it('refuses a token issued by a different room', async () => {
      const first = await createRoom();
      const second = await createRoom();
      const tokenForFirst = await join(first.roomCode, 'Ada');
      expect((await apiPost(`/api/game/${second.roomCode}/heartbeat`, undefined, { 'x-player-token': tokenForFirst })).status).toBe(401);
    });

    // Presence is a timestamp inside the encrypted state, so the only way to
    // see a heartbeat work is to age the player first — the seat is held for
    // five minutes, which no test can wait out.
    it('refreshes presence when the token is valid', async () => {
      const { roomCode } = await createRoom();
      const ada = await join(roomCode, 'Ada');

      const stale = Date.now() - 100_000;
      const mutated = await mutateRoomState(roomCode, s => ({
        ...s, participants: { ...s.participants, Ada: stale },
      }));
      expect(mutated).not.toBeNull();

      const before = await apiGet(`/api/game/${roomCode}`);
      expect(participants(await before.json() as GameStatePublic).Ada).toBe(stale);

      expect((await apiPost(`/api/game/${roomCode}/heartbeat`, undefined, { 'x-player-token': ada })).status).toBe(200);

      const after = await apiGet(`/api/game/${roomCode}`);
      expect(participants(await after.json() as GameStatePublic).Ada).toBeGreaterThan(stale);
    });
  });

  describe('host token', () => {
    it.each(['start', 'advance', 'end'])('refuses /%s with no host token', async route => {
      const { roomCode } = await createRoom();
      expect((await apiPost(`/api/game/${roomCode}/${route}`)).status).toBe(401);
    });

    it('refuses /kick with no host token', async () => {
      const { roomCode } = await createRoom();
      expect((await apiPost(`/api/game/${roomCode}/kick`, { name: 'Ada' })).status).toBe(401);
    });

    // The write-skip in loadAndUpdate is the assertion here, not just the 401:
    // a rejected request that still re-encrypted the row would refresh
    // updated_at, and a dead room could be kept alive past the 24h sweep
    // indefinitely by nothing but failed requests.
    it('refuses a wrong host token and writes nothing', async () => {
      const { roomCode, hostToken } = await createRoom();
      await join(roomCode, 'Ada');
      const [before] = await sql<{ updated_at: Date }[]>`select updated_at from game_states where room_code = ${roomCode}`;

      for (const route of ['start', 'advance', 'kick']) {
        const body = route === 'kick' ? { name: 'Ada' } : undefined;
        expect((await apiPost(`/api/game/${roomCode}/${route}`, body, { 'x-host-token': 'wrong' })).status).toBe(401);
      }

      const [after] = await sql<{ updated_at: Date }[]>`select updated_at from game_states where room_code = ${roomCode}`;
      expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
      expect((await apiGet(`/api/game/${roomCode}`).then(r => r.json()) as GameStatePublic).status).toBe('lobby');

      // The room is still there, so the real host can still run the game — and
      // this half is what makes the half above mean something: a successful
      // action DOES move updated_at, so the equality is not just two reads of a
      // column nothing ever writes.
      expect((await apiPost(`/api/game/${roomCode}/start`, undefined, { 'x-host-token': hostToken })).status).toBe(200);
      const [moved] = await sql<{ updated_at: Date }[]>`select updated_at from game_states where room_code = ${roomCode}`;
      expect(moved.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    });

    it('refuses /end with a wrong host token and leaves the room standing', async () => {
      const { roomCode, hostToken } = await createRoom();
      expect((await apiPost(`/api/game/${roomCode}/end`, undefined, { 'x-host-token': 'wrong' })).status).toBe(401);
      expect(await countRooms(sql)).toBe(1);
      expect((await apiPost(`/api/game/${roomCode}/end`, undefined, { 'x-host-token': hostToken })).status).toBe(200);
      // Ending an already-ended room is a 404, not a second success.
      expect((await apiPost(`/api/game/${roomCode}/end`, undefined, { 'x-host-token': hostToken })).status).toBe(404);
    });

    // A host token is not a player token and vice versa: neither header is read
    // by the other family of routes.
    it('does not accept a player token as a host token', async () => {
      const { roomCode } = await createRoom();
      const ada = await join(roomCode, 'Ada');
      expect((await apiPost(`/api/game/${roomCode}/start`, undefined, { 'x-host-token': ada })).status).toBe(401);
    });
  });

  describe('phase gates', () => {
    it('refuses a vote before the host has started, with 409', async () => {
      const { roomCode } = await createRoom();
      const ada = await join(roomCode, 'Ada');
      const res = await apiPost(`/api/game/${roomCode}/vote`, { matchupIndex: 0, choice: 'a' }, { 'x-player-token': ada });
      expect(res.status).toBe(409);
    });

    // The scenario the requirement names. Once the host advances, the round is
    // resolved and its matchups are gone; a vote arriving late must not be
    // silently accepted into the next round's empty tallies. 409 is the code
    // the player page already turns into "the host has moved on".
    it('refuses a vote into a resolved round, with 409', async () => {
      const { roomCode, hostToken } = await createRoom();
      const ada = await join(roomCode, 'Ada');
      await apiPost(`/api/game/${roomCode}/start`, undefined, { 'x-host-token': hostToken });
      expect((await apiPost(`/api/game/${roomCode}/vote`, { matchupIndex: 0, choice: 'a' }, { 'x-player-token': ada })).status).toBe(200);
      expect((await apiPost(`/api/game/${roomCode}/advance`, undefined, { 'x-host-token': hostToken })).status).toBe(200);

      // Two quotes, so one round: the game is now 'done'.
      const late = await apiPost(`/api/game/${roomCode}/vote`, { matchupIndex: 0, choice: 'b' }, { 'x-player-token': ada });
      expect(late.status).toBe(409);
    });

    it('refuses a second /start while voting is open, with 409', async () => {
      const { roomCode, hostToken } = await createRoom();
      await apiPost(`/api/game/${roomCode}/start`, undefined, { 'x-host-token': hostToken });
      expect((await apiPost(`/api/game/${roomCode}/start`, undefined, { 'x-host-token': hostToken })).status).toBe(409);
    });

    it('refuses /advance from the lobby, with 409', async () => {
      const { roomCode, hostToken } = await createRoom();
      expect((await apiPost(`/api/game/${roomCode}/advance`, undefined, { 'x-host-token': hostToken })).status).toBe(409);
    });
  });

  describe('vote payloads', () => {
    it.each([
      ['a matchup index sent as a string', { matchupIndex: '0', choice: 'a' }],
      ['a negative matchup index', { matchupIndex: -1, choice: 'a' }],
      ['a fractional matchup index', { matchupIndex: 0.5, choice: 'a' }],
      ['a choice that is neither a nor b', { matchupIndex: 0, choice: 'c' }],
      ['no body at all', undefined],
      ['a malformed body', '{ not json'],
    ])('refuses %s with 400', async (_label, body) => {
      const { roomCode, hostToken } = await createRoom();
      const ada = await join(roomCode, 'Ada');
      await apiPost(`/api/game/${roomCode}/start`, undefined, { 'x-host-token': hostToken });
      expect((await apiPost(`/api/game/${roomCode}/vote`, body, { 'x-player-token': ada })).status).toBe(400);
    });

    // A string "0" is trivially produced by reading a DOM dataset attribute,
    // and castVote compares with `i !== matchupIndex`, so it used to match no
    // matchup: the vote was discarded and the route still answered 200.
    it('refuses an index past the end of the round with 400, and records nothing', async () => {
      const { roomCode, hostToken } = await createRoom();
      const ada = await join(roomCode, 'Ada');
      await apiPost(`/api/game/${roomCode}/start`, undefined, { 'x-host-token': hostToken });
      expect((await apiPost(`/api/game/${roomCode}/vote`, { matchupIndex: 99, choice: 'a' }, { 'x-player-token': ada })).status).toBe(400);
      const view = await apiGet(`/api/game/${roomCode}`, { 'x-player-token': ada }).then(r => r.json()) as GameStatePublic;
      expect(view.matchups[0].myVote).toBeNull();
    });
  });

  describe('names', () => {
    it.each([
      ['a missing name', {}],
      ['an empty name', { name: '' }],
      ['a name of only whitespace', { name: '   ' }],
      ['a non-string name', { name: 7 }],
      ['a name over 24 characters', { name: 'A'.repeat(25) }],
    ])('refuses %s with 400', async (_label, body) => {
      const { roomCode } = await createRoom();
      expect((await apiPost(`/api/game/${roomCode}/join`, body)).status).toBe(400);
    });

    it('refuses a malformed join body with 400', async () => {
      const { roomCode } = await createRoom();
      expect((await apiPost(`/api/game/${roomCode}/join`, '{ not json')).status).toBe(400);
    });

    // U+200B is not whitespace to String.prototype.trim, so it survives the
    // "name required" check and is caught by hasVisibleCharacter instead. A
    // name of only these renders as nothing: invisible in the roster and
    // unaddressable by the host, so it cannot be kicked either.
    it('refuses an invisible name with 400 and says why', async () => {
      const { roomCode } = await createRoom();
      const res = await apiPost(`/api/game/${roomCode}/join`, { name: '​​⁠' });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('visible character') });
    });

    it('refuses a name held by an active player, with 409', async () => {
      const { roomCode } = await createRoom();
      await join(roomCode, 'Ada');
      // No token at all, and a token that is not the holder's: both are someone
      // else trying to take a seat that is occupied.
      expect((await apiPost(`/api/game/${roomCode}/join`, { name: 'Ada' })).status).toBe(409);
      expect((await apiPost(`/api/game/${roomCode}/join`, { name: 'Ada', existingToken: 'wrong' })).status).toBe(409);
    });

    it('lets the holder rejoin with their own token, keeping it', async () => {
      const { roomCode } = await createRoom();
      const ada = await join(roomCode, 'Ada');
      expect(await join(roomCode, 'Ada', ada)).toBe(ada);
    });

    // The other half of the same rule. The seat is held for PLAYER_TIMEOUT_MS,
    // and there is no route that ages a player, so the state is aged directly.
    it('frees the name once the holder has timed out', async () => {
      const { roomCode } = await createRoom();
      const ada = await join(roomCode, 'Ada');
      expect((await apiPost(`/api/game/${roomCode}/join`, { name: 'Ada' })).status).toBe(409);

      const mutated = await mutateRoomState(roomCode, s => ({
        ...s, participants: { ...s.participants, Ada: Date.now() - PLAYER_TIMEOUT_MS - 1_000 },
      }));
      expect(mutated).not.toBeNull();

      const res = await apiPost(`/api/game/${roomCode}/join`, { name: 'Ada' });
      expect(res.status).toBe(200);
      expect((await res.json() as { token: string }).token).not.toBe(ada);
    });

    // R3's normalisation, seen from the routes: the canonical form is what
    // holds the seat, so a name differing only in whitespace runs or Unicode
    // composition collides rather than sitting beside it in the roster.
    it('treats names differing only by whitespace runs as the same seat', async () => {
      const { roomCode } = await createRoom();
      await join(roomCode, 'Jon Smith');
      expect((await apiPost(`/api/game/${roomCode}/join`, { name: '  Jon   Smith  ' })).status).toBe(409);
    });

    it('refuses a kick with no name, and with a malformed body, at 400', async () => {
      const { roomCode, hostToken } = await createRoom();
      expect((await apiPost(`/api/game/${roomCode}/kick`, {}, { 'x-host-token': hostToken })).status).toBe(400);
      expect((await apiPost(`/api/game/${roomCode}/kick`, '{ not json', { 'x-host-token': hostToken })).status).toBe(400);
    });
  });
});
