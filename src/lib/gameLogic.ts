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

export function allVoted(state: GameState, now = Date.now()): boolean {
  const active = Object.entries(state.participants)
    .filter(([, ts]) => now - ts < PLAYER_TIMEOUT_MS)
    .map(([name]) => name);
  if (active.length === 0) return false;
  for (const m of state.matchups) {
    if (m.a === null || m.b === null) continue;
    const voted = new Set([...m.votes.a, ...m.votes.b]);
    for (const p of active) {
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

export function startVoting(state: GameState): GameState {
  return { ...state, status: 'voting' };
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
