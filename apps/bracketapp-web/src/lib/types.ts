export interface Quote {
  text: string;
  author: string;
  sortAuthor?: string;
}

export interface Matchup {
  a: Quote | null;
  b: Quote | null;
  votes: { a: string[]; b: string[] };
  winner: 'a' | 'b' | null;
}

// Sanitised shape sent to player clients — vote arrays replaced with counts
export interface MatchupPublic {
  a: Quote | null;
  b: Quote | null;
  votes: { a: number; b: number };
  myVote: 'a' | 'b' | null;
  winner: 'a' | 'b' | null;
}

export type GamePhase = 'lobby' | 'voting' | 'results' | 'done';

export interface GameState {
  roomCode: string;
  hostToken: string;
  status: GamePhase;
  round: number;
  totalRounds: number;
  matchups: Matchup[];
  bracketHistory: Matchup[][];
  participants: Record<string, number>;
  playerTokens: Record<string, string>;
  champion: Quote | null;
  createdAt: number;
}

// Shape returned to player clients (no secret fields, no voter names)
export interface GameStatePublic {
  roomCode: string;
  status: GamePhase;
  round: number;
  totalRounds: number;
  matchups: MatchupPublic[];
  bracketHistory: MatchupPublic[][];
  participants: Record<string, number>;
  champion: Quote | null;
  createdAt: number;
}
