import { GameState, GameStatePublic, Matchup, MatchupPublic, Quote } from './types';
export { parseQuotebook } from './parseQuotes';

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildBracket(quotes: Quote[]): Array<[Quote | null, Quote | null]> {
  const padded: Array<Quote | null> = shuffle(quotes);
  if (padded.length % 2 === 1) padded.push(null);

  const size = padded.length;

  const byAuthor = new Map<string, Quote[]>();
  for (const q of padded) {
    if (q === null) continue;
    const key = q.sortAuthor ?? q.author;
    const list = byAuthor.get(key) ?? [];
    list.push(q);
    byAuthor.set(key, list);
  }

  const authorsSorted = Array.from(byAuthor.keys()).sort((a, b) => byAuthor.get(b)!.length - byAuthor.get(a)!.length);
  const ordered: Quote[] = [];
  for (const author of authorsSorted) ordered.push(...byAuthor.get(author)!);

  const spread: number[] = [];
  let lo = 0, hi = size - 1, toggle = true;
  while (lo <= hi) {
    spread.push(toggle ? lo++ : hi--);
    toggle = !toggle;
  }

  const slots: Array<Quote | null> = new Array(size).fill(null);
  ordered.forEach((q, i) => { slots[spread[i]] = q; });

  const pairs: Array<[Quote | null, Quote | null]> = [];
  for (let i = 0; i < size; i += 2) pairs.push([slots[i], slots[i + 1]]);
  return pairs;
}

export function createGame(quotes: Quote[], hostToken: string): GameState {
  const roomCode = generateRoomCode();
  const pairs = buildBracket(quotes);
  const matchups: Matchup[] = pairs.map(([a, b]) => ({ a, b, votes: { a: [], b: [] }, winner: null }));
  // ceil, not round: the bracket halves with Math.ceil each round, so a
  // non-power-of-two field needs one more round than log2 rounded to nearest.
  // With round(), 9-10 / 17-22 / 33-44 quotes under-reported by one and the
  // header rendered e.g. "Round 4 of 3".
  const totalRounds = Math.ceil(Math.log2(matchups.length * 2));

  return {
    roomCode,
    hostToken,
    status: 'lobby',
    round: 1,
    totalRounds,
    matchups,
    bracketHistory: [],
    participants: {},
    playerTokens: {},
    champion: null,
    createdAt: Date.now(),
  };
}

export function joinGame(state: GameState, playerName: string, playerToken: string): GameState {
  return {
    ...state,
    participants: { ...state.participants, [playerName]: Date.now() },
    playerTokens: { ...state.playerTokens, [playerName]: playerToken },
  };
}

/** Canonical storage form for a player name (R3).
 *
 *  NFC so two visually identical names cannot both exist as separate keys, and
 *  internal whitespace runs collapsed so "Jon   Smith" and "Jon Smith" collide
 *  rather than sitting side by side in the roster.
 *
 *  Deliberately does NOT strip zero-width characters, even though the plan's
 *  wording suggested folding that in here: U+200D ZERO WIDTH JOINER is what
 *  holds emoji sequences together, so stripping it would break a name like
 *  a family emoji into separate glyphs. Detection of an invisible name is a
 *  separate question, answered by hasVisibleCharacter below.
 */
export function normalizePlayerName(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** True when anything remains after removing characters that render as nothing
 *  (R4). Format characters, zero-width spaces and the BOM are stripped for this
 *  test only - a name made entirely of them is invisible in the roster and
 *  unaddressable by the host. */
export function hasVisibleCharacter(name: string): boolean {
  // Checked by code point rather than a \p{Cf} class: that needs the `u`
  // regex flag, which needs an es6+ target, and this tsconfig sets none.
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) continue;   // whitespace
    if (c === 0x00ad || c === 0x180e) continue;             // soft hyphen, MVS
    if (c >= 0x200b && c <= 0x200f) continue;               // zero-width, bidi marks
    if (c >= 0x202a && c <= 0x202e) continue;               // bidi embedding
    if (c >= 0x2060 && c <= 0x2064) continue;               // word joiner, invisible ops
    if (c >= 0x2066 && c <= 0x2069) continue;               // bidi isolates
    if (c === 0xfeff) continue;                             // BOM / ZWNBSP
    return true;
  }
  return false;
}

// Resolves a player token back to the name it was issued to, or null when the
// token belongs to nobody in this room.
//
// The name cannot travel in a header: HTTP header values must be Latin-1, so
// `new Headers({'x-player-name': 'O’Brien'})` throws in the browser before the
// request is ever sent - and iOS smart punctuation turns a typed ' into ’ on
// its own. The token is the identity; the name is derived from it here.
//
// Iterating own properties matters: `playerTokens[name]` reads through the
// prototype chain, so a player who calls themselves `toString` or `constructor`
// would match a function off Object.prototype - truthy, and not their token.
export function playerNameForToken(state: GameState, token: string | null | undefined): string | null {
  if (!token) return null;
  for (const [name, playerToken] of Object.entries(state.playerTokens)) {
    if (playerToken === token) return name;
  }
  return null;
}

/** Removes a player from the roster, banking their token so the poll route can
 *  tell them what happened rather than silently demoting them to a spectator.
 *
 *  Votes are deliberately left in place (R10): the round already happened, and
 *  rewriting its recorded counts because someone left afterwards would make the
 *  standings disagree with what the room actually saw.
 *
 *  An unknown name returns the state unchanged, so no write occurs. The lookup
 *  is an own-property check - a player named `toString` must not resolve to a
 *  function inherited from Object.prototype.
 */
export function kickPlayer(state: GameState, playerName: string): GameState {
  if (!Object.prototype.hasOwnProperty.call(state.playerTokens, playerName)) return state;
  const token = state.playerTokens[playerName];
  const participants = { ...state.participants };
  const playerTokens = { ...state.playerTokens };
  delete participants[playerName];
  delete playerTokens[playerName];
  return {
    ...state,
    participants,
    playerTokens,
    removedTokens: [...(state.removedTokens ?? []), token],
  };
}
// Updates heartbeat timestamp without touching playerTokens
export function refreshHeartbeat(state: GameState, playerName: string): GameState {
  if (!(playerName in state.participants)) return state;
  return { ...state, participants: { ...state.participants, [playerName]: Date.now() } };
}

export function castVote(state: GameState, matchupIndex: number, playerName: string, choice: 'a' | 'b'): GameState {
  const matchups = state.matchups.map((m, i) => {
    if (i !== matchupIndex) return m;
    return {
      ...m,
      votes: {
        a: m.votes.a.filter(n => n !== playerName),
        b: m.votes.b.filter(n => n !== playerName),
        [choice]: [...m.votes[choice].filter(n => n !== playerName), playerName],
      },
    };
  });
  return { ...state, matchups };
}

// Five minutes, and deliberately enormous next to the 8s heartbeat. Mobile
// browsers suspend timers whenever the screen locks or the tab is backgrounded,
// so this is not really a liveness measure - it is how long a player may look
// at something else and still be holding their seat. 24s skipped the votes of
// anyone glancing at a notification; 45s still dropped players who took a call
// or answered a message.
//
// The cost is on the other side: `allVoted` below only unlocks the host's
// "Show Results" once every *active* player has voted, so someone who truly
// leaves now holds that gate shut for five minutes rather than 45s. The host
// advancing early is the intended escape hatch, and always was.
export const PLAYER_TIMEOUT_MS = 300_000;

/** The single definition of "active". The host roster, the per-matchup
 *  denominator, the player page's count and the advance gate all route through
 *  this, so the visible roster and the gate can never disagree. */
export function activePlayers(state: GameState, now = Date.now()): string[] {
  return Object.entries(state.participants)
    .filter(([, ts]) => now - ts < PLAYER_TIMEOUT_MS)
    .map(([name]) => name);
}

/** Players who both were present when the round started and are still active.
 *  A player who joins mid-round may vote, but does not hold the gate shut. */
export function eligibleVoters(state: GameState, now = Date.now()): string[] {
  const active = activePlayers(state, now);
  // Absent on rooms created before this field existed: fall back to the old
  // behaviour of gating on everyone active rather than locking those rooms.
  if (!state.roundVoters) return active;
  const snapshot = new Set(state.roundVoters);
  return active.filter(name => snapshot.has(name));
}

export function allVoted(state: GameState, now = Date.now()): boolean {
  const eligible = eligibleVoters(state, now);
  // An empty room cannot have "everyone voted". R11a's abandoned-room case is
  // auto-advance's own condition, so the host button's meaning is unchanged.
  if (eligible.length === 0) return false;
  for (const m of state.matchups) {
    if (m.a === null || m.b === null) continue;
    const voted = new Set([...m.votes.a, ...m.votes.b]);
    for (const p of eligible) {
      if (!voted.has(p)) return false;
    }
  }
  return true;
}

export function advanceRound(state: GameState): GameState {
  const resolved = state.matchups.map((m): Matchup => {
    if (m.a === null) return { ...m, winner: 'b' };
    if (m.b === null) return { ...m, winner: 'a' };
    const va = m.votes.a.length, vb = m.votes.b.length;
    const winner: 'a' | 'b' = va === vb ? (Math.random() < 0.5 ? 'a' : 'b') : va > vb ? 'a' : 'b';
    return { ...m, winner };
  });

  const winners: Quote[] = resolved.map(m => (m.winner === 'a' ? m.a! : m.b!));
  const newHistory = [...state.bracketHistory, resolved];

  if (winners.length === 1) {
    return { ...state, status: 'done', champion: winners[0], bracketHistory: newHistory, matchups: [] };
  }

  const nextMatchups: Matchup[] = [];
  for (let i = 0; i < winners.length; i += 2) {
    nextMatchups.push({
      a: winners[i] ?? null,
      b: winners[i + 1] ?? null,
      votes: { a: [], b: [] },
      winner: null,
    });
  }

  return { ...state, status: 'results', round: state.round + 1, matchups: nextMatchups, bracketHistory: newHistory };
}

export function startVoting(state: GameState, now = Date.now()): GameState {
  return { ...state, status: 'voting', roundVoters: activePlayers(state, now) };
}

export function getVoteCounts(m: Matchup): [number, number] {
  return [m.votes.a.length, m.votes.b.length];
}

export function truncate(text: string, len: number): string {
  return text.length > len ? text.slice(0, len) + '…' : text;
}

// Returns a player-safe view of game state: vote arrays → counts, myVote added per matchup
export function sanitizeForPlayer(state: GameState, playerName: string | null): GameStatePublic {
  const sanitizeMatchup = (m: Matchup): MatchupPublic => ({
    a: m.a,
    b: m.b,
    votes: { a: m.votes.a.length, b: m.votes.b.length },
    myVote: playerName
      ? (m.votes.a.includes(playerName) ? 'a' : m.votes.b.includes(playerName) ? 'b' : null)
      : null,
    winner: m.winner,
  });

  return {
    roomCode: state.roomCode,
    status: state.status,
    round: state.round,
    totalRounds: state.totalRounds,
    matchups: state.matchups.map(sanitizeMatchup),
    bracketHistory: state.bracketHistory.map(round => round.map(sanitizeMatchup)),
    participants: state.participants,
    champion: state.champion,
    createdAt: state.createdAt,
  };
}
