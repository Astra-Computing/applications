import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildBracket,
  createGame,
  advanceRound,
  playerNameForToken,
  normalizePlayerName,
  hasVisibleCharacter,
  allVoted,
  activePlayers,
  eligibleVoters,
  startVoting,
  kickPlayer,
  PLAYER_TIMEOUT_MS,
} from '@/lib/gameLogic';
import type { GameState, Matchup, Quote } from '@/lib/types';

const SRC = path.resolve(__dirname);

/**
 * Source with comments removed.
 *
 * Carried across from `_check_identity.js`. Without it these assertions match
 * the comments that explain why the header is gone — the routes deliberately
 * say an older client may still send `x-player-name` and it is ignored — so a
 * "passing" test would be asserting against prose. The second replace keeps
 * the `://` in a URL from being read as a line comment.
 */
function readCode(rel: string): string {
  return readFileSync(path.resolve(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const quotes = (n: number): Quote[] =>
  Array.from({ length: n }, (_, i) => ({ text: `quote ${i}`, author: `A${i}` }));

/** Drive a whole game to a champion, resolving every matchup. */
function playOut(n: number): GameState {
  let state = createGame(quotes(n), 'host-token');
  let guard = 0;
  while (state.status !== 'done' && guard++ < 20) {
    state = { ...state, status: 'voting' };
    state = advanceRound(state);
  }
  return state;
}

const byeTextOf = (round: Matchup[]) => {
  const m = round.find(x => x.a === null || x.b === null);
  return m ? (m.a ?? m.b)!.text : null;
};

// ── Player identity (was _check_identity.js) ─────────────────────────────────

describe('playerNameForToken', () => {
  const state = {
    playerTokens: {
      'O’Brien': 't1',
      'Jon 🍻': 't2',
      'Łukasz': 't3',
      'ゆき': 't4',
      toString: 't5',
      constructor: 't6',
    },
  } as unknown as GameState;

  it.each([
    ['O’Brien', 't1'],
    ['Jon 🍻', 't2'],
    ['Łukasz', 't3'],
    ['ゆき', 't4'],
  ])('resolves %s from its token', (name, token) => {
    expect(playerNameForToken(state, token)).toBe(name);
  });

  it('resolves a player named like an Object.prototype member', () => {
    // `playerTokens[name]` would read through the prototype chain and match a
    // function - truthy, and not their token.
    expect(playerNameForToken(state, 't5')).toBe('toString');
    expect(playerNameForToken(state, 't6')).toBe('constructor');
  });

  it('returns null for a token belonging to nobody', () => {
    expect(playerNameForToken(state, 'nope')).toBeNull();
  });

  it('returns null for an absent token', () => {
    expect(playerNameForToken(state, null)).toBeNull();
    expect(playerNameForToken(state, undefined)).toBeNull();
    expect(playerNameForToken(state, '')).toBeNull();
  });

  it('never matches a value inherited from the prototype chain', () => {
    const empty = { playerTokens: {} } as unknown as GameState;
    // Object.prototype.toString is a function, never a token string.
    expect(playerNameForToken(empty, 'toString')).toBeNull();
  });
});

describe('no authenticated route carries the player name in a header', () => {
  // The name cannot travel in a header: header values must be Latin-1, so a
  // curly apostrophe - which iOS smart punctuation produces unaided - threw
  // inside fetch before the request left the phone, stranding that player.
  const files = [
    '../app/api/game/[code]/route.ts',
    '../app/api/game/[code]/vote/route.ts',
    '../app/api/game/[code]/heartbeat/route.ts',
    '../app/room/[code]/player/page.tsx',
  ];

  it.each(files)('%s never sends or reads x-player-name', file => {
    expect(readCode(file)).not.toContain('x-player-name');
  });

  it.each(files.slice(0, 3))('%s resolves the name from the token', file => {
    expect(readCode(file)).toContain('playerNameForToken');
  });
});

// ── Name normalisation ───────────────────────────────────────────────────────

describe('normalizePlayerName', () => {
  it('collapses internal whitespace runs', () => {
    expect(normalizePlayerName('  Jon   Smith ')).toBe('Jon Smith');
  });

  it('composes to NFC so two identical-looking names collide', () => {
    expect(normalizePlayerName('é')).toBe('é');
  });

  it('leaves an emoji name intact', () => {
    expect(normalizePlayerName('O’Brien 🍻')).toBe('O’Brien 🍻');
  });

  it('does not split a ZWJ emoji sequence', () => {
    // Stripping U+200D here would turn one family glyph into three.
    const family = '👨‍👩‍👧';
    expect(normalizePlayerName(family)).toContain('‍');
  });
});

describe('hasVisibleCharacter', () => {
  it.each([
    ['zero-width only', '​‌‍'],
    ['BOM only', '﻿'],
    ['bidi controls only', '‪‬'],
    ['whitespace only', '   '],
  ])('rejects a name that is %s', (_label, name) => {
    expect(hasVisibleCharacter(name)).toBe(false);
  });

  it.each([
    ['a normal name', 'Ana'],
    ['an emoji', '🍻'],
    ['a ZWJ family emoji', '👨‍👩‍👧'],
  ])('accepts %s', (_label, name) => {
    expect(hasVisibleCharacter(name)).toBe(true);
  });
});

// ── Active players and the advance gate ──────────────────────────────────────

describe('activePlayers / eligibleVoters / allVoted', () => {
  const now = 1_000_000;
  const base = (participants: Record<string, number>, extra: Partial<GameState> = {}) =>
    ({
      participants,
      matchups: [{ a: { text: 'a', author: 'A' }, b: { text: 'b', author: 'B' }, votes: { a: [], b: [] }, winner: null }],
      ...extra,
    }) as unknown as GameState;

  it('counts only players seen inside the timeout', () => {
    const s = base({ Ana: now, Ben: now - PLAYER_TIMEOUT_MS - 1 });
    expect(activePlayers(s, now)).toEqual(['Ana']);
  });

  it('falls back to all active players when roundVoters is absent', () => {
    // Rooms created before roundVoters existed must keep working.
    const s = base({ Ana: now, Ben: now });
    expect(eligibleVoters(s, now).sort()).toEqual(['Ana', 'Ben']);
  });

  it('excludes a mid-round joiner from the gate', () => {
    const s = base({ Ana: now, Ben: now }, { roundVoters: ['Ana'] });
    expect(eligibleVoters(s, now)).toEqual(['Ana']);
  });

  it('is true once every eligible voter has voted, ignoring a mid-round joiner', () => {
    const s = base({ Ana: now, Ben: now }, {
      roundVoters: ['Ana'],
      matchups: [{ a: { text: 'a', author: 'A' }, b: { text: 'b', author: 'B' }, votes: { a: ['Ana'], b: [] }, winner: null }],
    } as Partial<GameState>);
    expect(allVoted(s, now)).toBe(true);
  });

  it('is false while an eligible voter has not voted', () => {
    const s = base({ Ana: now, Ben: now }, { roundVoters: ['Ana', 'Ben'] });
    expect(allVoted(s, now)).toBe(false);
  });

  it('is false for an empty room', () => {
    // An empty room cannot have "everyone voted"; the abandoned-room case is
    // auto-advance's own condition, so the manual button keeps its meaning.
    expect(allVoted(base({}), now)).toBe(false);
  });

  it('is false when every snapshot member has timed out', () => {
    const s = base({ Ana: now - PLAYER_TIMEOUT_MS - 1, Ben: now }, { roundVoters: ['Ana'] });
    expect(allVoted(s, now)).toBe(false);
  });

  it('snapshots the round voters when voting starts', () => {
    const s = base({ Ana: now, Ben: now - PLAYER_TIMEOUT_MS - 1 });
    expect(startVoting(s, now).roundVoters).toEqual(['Ana']);
  });
});

describe('kickPlayer', () => {
  const state = {
    participants: { Ana: 1, Ben: 2 },
    playerTokens: { Ana: 'ta', Ben: 'tb' },
  } as unknown as GameState;

  it('removes the player and banks their token', () => {
    const next = kickPlayer(state, 'Ana');
    expect(next.participants).not.toHaveProperty('Ana');
    expect(next.playerTokens).not.toHaveProperty('Ana');
    expect(next.removedTokens).toContain('ta');
  });

  it('leaves an unknown name untouched', () => {
    expect(kickPlayer(state, 'Nobody')).toBe(state);
  });

  it('does not treat a prototype member as a player', () => {
    expect(kickPlayer(state, 'toString')).toBe(state);
  });
});

// ── The bracket (was _check_bracket.js) ──────────────────────────────────────
//
// The BYE is random, so every invariant here is asserted over many runs. A
// single run proves nothing about a randomised choice.

describe('buildBracket', () => {
  it('places the round-1 BYE on more than one slot across 200 builds', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      seen.add(buildBracket(quotes(9)).findIndex(([a, b]) => a === null || b === null));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('keeps every quote exactly once with exactly one BYE', () => {
    for (let i = 0; i < 200; i++) {
      const flat = buildBracket(quotes(9)).flat();
      const present = flat.filter(Boolean) as Quote[];
      expect(present).toHaveLength(9);
      expect(new Set(present.map(q => q.text)).size).toBe(9);
      expect(flat.filter(x => x === null)).toHaveLength(1);
    }
  });

  it('produces no BYE for an even field', () => {
    for (let i = 0; i < 100; i++) {
      expect(buildBracket(quotes(8)).flat().some(x => x === null)).toBe(false);
    }
  });

  it('clusters an author rather than separating them, which is intended', () => {
    // Quotes are ordered by author then dealt to slots 0, last, 1, last-1 ...
    // and pairs are ADJACENT slots, so slots 0 and 1 hold the top author's 1st
    // and 3rd quotes: the same pair. An author with 3+ quotes therefore meets
    // themselves in round 1 reliably, which is a deliberate balancing choice -
    // it stops one prolific author occupying half the later rounds.
    //
    // Do NOT "fix" this toward separation. Removing the interleave roughly
    // halves early meetings, which is the opposite of what the game wants.
    const field = [
      ...Array.from({ length: 6 }, (_, k) => ({ text: `same ${k}`, author: 'Same' })),
      ...Array.from({ length: 8 }, (_, k) => ({ text: `other ${k}`, author: `Other${k}` })),
    ];
    let clashes = 0;
    for (let i = 0; i < 100; i++) {
      for (const [a, b] of buildBracket(field)) {
        if (a && b && a.author === b.author) clashes++;
      }
    }
    expect(clashes).toBeGreaterThan(0);
  });
});

describe('advanceRound', () => {
  it('never gives the BYE to the same quote in consecutive rounds', () => {
    let violations = 0;
    let byeRounds = 0;
    for (let i = 0; i < 60; i++) {
      for (const n of [9, 11, 12, 13, 17]) {
        const byes = playOut(n).bracketHistory.map(byeTextOf);
        byes.forEach((b, r) => {
          if (b !== null) byeRounds++;
          if (b !== null && r > 0 && byes[r - 1] === b) violations++;
        });
      }
    }
    expect(byeRounds).toBeGreaterThan(0);
    expect(violations).toBe(0);
  });

  it('produces a bracket whose boxes never overlap', () => {
    // The real constraint the BYE's even-position rule exists to guarantee.
    // Appending the BYE to the end of the winners lets a pair straddle it, and
    // because BracketDiagram draws each box at the mean of the boxes feeding
    // it, a solo box then lands on top of its neighbours: 905 overlapping
    // boxes per 1000 games when this was got wrong.
    //
    // Replicates BracketDiagram's layout rather than asserting an index,
    // because the index is a mechanism and overlap is the property.
    const SLOT_H = 76, BOX_H = 60, PAD_Y = 20;
    const centerY = (m: number, r: number) => PAD_Y + (m + 0.5) * Math.pow(2, r) * SLOT_H;
    const key = (q: Quote) => `${q.author}|${q.text}`;

    for (let i = 0; i < 100; i++) {
      const rounds = playOut(11).bracketHistory;

      const feeders: number[][][] = rounds.map(() => []);
      for (let r = 0; r < rounds.length - 1; r++) {
        const idx = new Map<string, number>();
        rounds[r + 1].forEach((m, j) => {
          if (m.a) idx.set(key(m.a), j);
          if (m.b) idx.set(key(m.b), j);
        });
        feeders[r + 1] = rounds[r + 1].map(() => []);
        rounds[r].forEach((m, mi) => {
          const won = m.winner ? m[m.winner] : null;
          if (!won) return;
          const t = idx.get(key(won));
          if (t !== undefined) feeders[r + 1][t].push(mi);
        });
      }

      const cy: number[][] = [];
      rounds.forEach((round, r) => {
        cy.push(round.map((_m, m) => {
          const from = r > 0 ? (feeders[r][m] ?? []) : [];
          return from.length
            ? from.reduce((acc, f) => acc + cy[r - 1][f], 0) / from.length
            : centerY(m, r);
        }));
      });

      cy.forEach((row, r) => {
        for (let a = 0; a < row.length; a++) {
          // Every box after round 1 must have a feeder, or a winner went missing.
          if (r > 0) expect(feeders[r][a].length).toBeGreaterThan(0);
          for (let b = a + 1; b < row.length; b++) {
            expect(Math.abs(row[a] - row[b])).toBeGreaterThanOrEqual(BOX_H);
          }
        }
      });
    }
  });

  it.each([[9, 4], [10, 4], [17, 5], [33, 6]])(
    'reports %i quotes as %i rounds', (n, expected) => {
      expect(createGame(quotes(n), 'h').totalRounds).toBe(expected);
    });

  it.each([3, 5, 9, 11, 12, 13, 17, 33])('resolves a %i-quote field to a champion', n => {
    for (let i = 0; i < 20; i++) {
      const done = playOut(n);
      expect(done.status).toBe('done');
      expect(done.champion).toBeTruthy();
    }
  });
});
