import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Sql } from 'postgres';
import { connect, applySchema, resetDatabase } from '../support/db';
import { apiGet, apiPost } from '../support/server';
import type { GameState, GameStatePublic, Quote } from '@/lib/types';

/**
 * The routes, driven end to end against the running server and the test
 * database (R11). No browser: everything asserted here is invisible from one —
 * the browser sees a rendered consequence, never the status code or the row.
 */

/** The host's view: the raw state with the three secret fields removed. Both
 *  GET and /advance strip exactly these, which is itself worth asserting. */
type HostView = Omit<GameState, 'hostToken' | 'playerTokens' | 'removedTokens'>;

const QUOTES: Quote[] = [
  { text: 'The first quote', author: 'Ada' },
  { text: 'The second quote', author: 'Bram' },
  { text: 'The third quote', author: 'Cleo' },
  { text: 'The fourth quote', author: 'Dev' },
];

async function createRoom(quotes: Quote[] = QUOTES) {
  const res = await apiPost('/api/game/create', { quotes });
  expect(res.status).toBe(200);
  return await res.json() as { roomCode: string; hostToken: string };
}

async function join(code: string, name: string, existingToken?: string) {
  const res = await apiPost(`/api/game/${code}/join`, { name, existingToken });
  expect(res.status).toBe(200);
  return (await res.json() as { ok: true; token: string }).token;
}

async function hostView(code: string, hostToken: string): Promise<HostView> {
  const res = await apiGet(`/api/game/${code}`, { 'x-host-token': hostToken });
  expect(res.status).toBe(200);
  return await res.json() as HostView;
}

async function playerView(code: string, playerToken?: string): Promise<GameStatePublic> {
  const res = await apiGet(`/api/game/${code}`, playerToken ? { 'x-player-token': playerToken } : {});
  expect(res.status).toBe(200);
  return await res.json() as GameStatePublic;
}

describe('game lifecycle', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connect();
    await applySchema(sql);
  });

  // R6, and R2 with it: `rate_limits` is truncated too, so the ten-per-hour cap
  // on /create cannot refuse a later test in this file. Every request here keys
  // to 'unknown' because none sends x-forwarded-for.
  beforeEach(async () => {
    await resetDatabase(sql);
  });

  afterAll(async () => {
    await sql.end();
  });

  it('runs a whole game: create, join, heartbeat, start, vote, advance, end', async () => {
    const { roomCode, hostToken } = await createRoom();
    expect(roomCode).toMatch(/^[A-Z]{4}$/);

    // Lobby, seen by nobody in particular.
    const lobby = await playerView(roomCode);
    expect(lobby.status).toBe('lobby');
    expect(lobby.round).toBe(1);
    expect(lobby.totalRounds).toBe(2);
    expect(lobby.matchups).toHaveLength(2);
    expect(lobby.participants).toEqual({});

    const ada = await join(roomCode, 'Ada');
    const bram = await join(roomCode, 'Bram');
    expect(ada).not.toBe(bram);

    expect((await apiPost(`/api/game/${roomCode}/heartbeat`, undefined, { 'x-player-token': ada })).status).toBe(200);

    // The host's view carries the secrets stripped. Asserted here rather than
    // trusted: the raw state holds every player's token, and a host page that
    // received them could impersonate any player in the room.
    const beforeStart = await hostView(roomCode, hostToken);
    expect(Object.keys(beforeStart.participants).sort()).toEqual(['Ada', 'Bram']);
    expect(beforeStart).not.toHaveProperty('hostToken');
    expect(beforeStart).not.toHaveProperty('playerTokens');
    expect(beforeStart).not.toHaveProperty('removedTokens');

    expect((await apiPost(`/api/game/${roomCode}/start`, undefined, { 'x-host-token': hostToken })).status).toBe(200);
    expect((await playerView(roomCode)).status).toBe('voting');

    for (const token of [ada, bram]) {
      for (const matchupIndex of [0, 1]) {
        const res = await apiPost(`/api/game/${roomCode}/vote`, { matchupIndex, choice: 'a' }, { 'x-player-token': token });
        expect(res.status).toBe(200);
      }
    }

    // R13 in miniature: /vote wrote it, GET reads it back — and reads it back
    // as *this* player's vote, resolved from the token alone.
    const adaView = await playerView(roomCode, ada);
    expect(adaView.matchups.map(m => m.myVote)).toEqual(['a', 'a']);
    expect(adaView.matchups[0].votes).toEqual({ a: 2, b: 0 });

    const advanced = await apiPost(`/api/game/${roomCode}/advance`, undefined, { 'x-host-token': hostToken });
    expect(advanced.status).toBe(200);
    const afterRound1 = (await advanced.json() as { ok: true; state: HostView }).state;
    expect(afterRound1.status).toBe('results');
    expect(afterRound1.round).toBe(2);
    expect(afterRound1.matchups).toHaveLength(1);
    expect(afterRound1.bracketHistory).toHaveLength(1);
    // Everyone voted 'a', so both round-1 winners are the 'a' side.
    expect(afterRound1.bracketHistory[0].map(m => m.winner)).toEqual(['a', 'a']);
    expect(afterRound1).not.toHaveProperty('playerTokens');

    // 'results' is a legal phase to start from — that is how round 2 opens.
    expect((await apiPost(`/api/game/${roomCode}/start`, undefined, { 'x-host-token': hostToken })).status).toBe(200);
    expect((await apiPost(`/api/game/${roomCode}/vote`, { matchupIndex: 0, choice: 'b' }, { 'x-player-token': bram })).status).toBe(200);

    const final = await apiPost(`/api/game/${roomCode}/advance`, undefined, { 'x-host-token': hostToken });
    expect(final.status).toBe(200);
    const done = (await final.json() as { ok: true; state: HostView }).state;
    expect(done.status).toBe('done');
    expect(done.matchups).toEqual([]);
    expect(QUOTES.map(q => q.text)).toContain(done.champion?.text);

    // The room survives 'done' deliberately — deleting it on advance used to
    // race the 2s poll, so nobody ever saw the champion. /end is what removes it.
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from game_states where room_code = ${roomCode}`;
    expect(row.n).toBe(1);

    expect((await apiPost(`/api/game/${roomCode}/end`, undefined, { 'x-host-token': hostToken })).status).toBe(200);
    expect((await apiGet(`/api/game/${roomCode}`)).status).toBe(404);
  });

  // R13. The state is one AES-256-GCM envelope in a single jsonb column, so
  // "written by one route, read by another" is the only way to observe it —
  // and the column itself is checked, because a regression that stored the
  // plaintext would leave every assertion above passing.
  it('round-trips encrypted state between routes and stores no plaintext', async () => {
    // Deliberately awkward text: a curly apostrophe and non-Latin-1 characters
    // survive JSON and the cipher but cannot travel in an HTTP header, which is
    // why the player's name is resolved from their token rather than sent.
    const quotes: Quote[] = [
      { text: 'It’s a trap — «Ackbar» said 🪤', author: 'O’Brien' },
      { text: 'Ordinary runner-up', author: 'Plain' },
    ];
    const { roomCode, hostToken } = await createRoom(quotes);
    const token = await join(roomCode, 'Zoë O’Brien');

    const seen = await hostView(roomCode, hostToken);
    expect(seen.matchups.flatMap(m => [m.a, m.b]).map(q => q?.text).sort())
      .toEqual(quotes.map(q => q.text).sort());
    expect(Object.keys(seen.participants)).toEqual(['Zoë O’Brien']);

    // A vote written under that name is read back under the same name, so the
    // round-trip survives re-encryption rather than only the initial write.
    await apiPost(`/api/game/${roomCode}/start`, undefined, { 'x-host-token': hostToken });
    await apiPost(`/api/game/${roomCode}/vote`, { matchupIndex: 0, choice: 'b' }, { 'x-player-token': token });
    const voted = await hostView(roomCode, hostToken);
    expect(voted.matchups[0].votes.b).toEqual(['Zoë O’Brien']);

    const [stored] = await sql<{ envelope: Record<string, string> }[]>`
      select envelope from game_states where room_code = ${roomCode}`;
    expect(Object.keys(stored.envelope).sort()).toEqual(['enc', 'iv', 'tag']);
    const raw = JSON.stringify(stored.envelope);
    expect(raw).not.toContain('Ackbar');
    expect(raw).not.toContain('Zoë');
    expect(raw).not.toContain(hostToken);
  });

  // R10, and the reason it is a requirement: the round already happened, so
  // rewriting its counts because someone left afterwards would make the
  // standings disagree with what the room actually saw.
  it('kicks a player, keeps their votes, and lets them rejoin', async () => {
    const { roomCode, hostToken } = await createRoom();
    const ada = await join(roomCode, 'Ada');
    const bram = await join(roomCode, 'Bram');
    await apiPost(`/api/game/${roomCode}/start`, undefined, { 'x-host-token': hostToken });
    await apiPost(`/api/game/${roomCode}/vote`, { matchupIndex: 0, choice: 'a' }, { 'x-player-token': ada });
    await apiPost(`/api/game/${roomCode}/vote`, { matchupIndex: 0, choice: 'b' }, { 'x-player-token': bram });

    const kicked = await apiPost(`/api/game/${roomCode}/kick`, { name: 'Ada' }, { 'x-host-token': hostToken });
    expect(kicked.status).toBe(200);

    const after = await hostView(roomCode, hostToken);
    expect(Object.keys(after.participants)).toEqual(['Bram']);
    expect(after.matchups[0].votes.a).toEqual(['Ada']);
    expect(after.matchups[0].votes.b).toEqual(['Bram']);

    // 403 with a machine-readable reason, not a silent demotion to spectator:
    // the player page needs to tell this apart from an expired token so a
    // reload lands on the join screen instead of looping.
    const removed = await apiGet(`/api/game/${roomCode}`, { 'x-player-token': ada });
    expect(removed.status).toBe(403);
    expect(await removed.json()).toMatchObject({ reason: 'removed' });
    expect((await apiPost(`/api/game/${roomCode}/heartbeat`, undefined, { 'x-player-token': ada })).status).toBe(401);

    // The name is free again, and the rejoin issues a different token — the old
    // one stays banked in removedTokens.
    const adaAgain = await join(roomCode, 'Ada');
    expect(adaAgain).not.toBe(ada);
    expect(Object.keys((await hostView(roomCode, hostToken)).participants).sort()).toEqual(['Ada', 'Bram']);
  });

  // Unknown-name kick returns the state object unchanged, so loadAndUpdate
  // skips the write entirely. That is why it answers 200 rather than 404: the
  // route reports "the room accepted your request", not "that player existed".
  it('accepts a kick for a name nobody holds, and writes nothing', async () => {
    const { roomCode, hostToken } = await createRoom();
    await join(roomCode, 'Ada');
    const [before] = await sql<{ updated_at: Date }[]>`select updated_at from game_states where room_code = ${roomCode}`;

    const res = await apiPost(`/api/game/${roomCode}/kick`, { name: 'Nobody' }, { 'x-host-token': hostToken });
    expect(res.status).toBe(200);

    const [after] = await sql<{ updated_at: Date }[]>`select updated_at from game_states where room_code = ${roomCode}`;
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
  });
});

describe('room codes', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connect();
    await applySchema(sql);
  });
  beforeEach(async () => { await resetDatabase(sql); });
  afterAll(async () => { await sql.end(); });

  it('gives each room a distinct code and accepts a lowercase one in the URL', async () => {
    const a = await createRoom();
    const b = await createRoom();
    expect(a.roomCode).not.toBe(b.roomCode);

    // Every route uppercases params.code before validating, so a link typed in
    // lowercase resolves to the same room rather than 400ing on the regex.
    const res = await apiGet(`/api/game/${a.roomCode.toLowerCase()}`);
    expect(res.status).toBe(200);
    expect((await res.json() as GameStatePublic).roomCode).toBe(a.roomCode);
  });
});
