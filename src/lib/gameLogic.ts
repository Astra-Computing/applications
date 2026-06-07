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
  const totalRounds = Math.round(Math.log2(matchups.length * 2));

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

export const PLAYER_TIMEOUT_MS = 24_000;

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
