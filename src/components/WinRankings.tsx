import { Matchup } from '@/lib/types';

/**
 * The two end-of-game leaderboards, shown side by side under the champion card
 * on the host screen.
 *
 * Host-only by design, and that is a data constraint rather than a layout one:
 * the player-popularity table needs to know who voted for what, and only the
 * host's response carries the raw voter-name arrays. Players receive vote
 * counts plus their own `myVote`, so this cannot be computed on a phone
 * without a new server-side field.
 */

interface Props {
  /** Resolved rounds, oldest first. `state.bracketHistory` on the host. */
  bracketHistory: Matchup[][];
}

interface AuthorRow {
  author: string;
  /** 1-based round number the author's best quote survived *into*. */
  reached: number;
  /** How many of their quotes entered the bracket at all. */
  entered: number;
  champion: boolean;
}

interface PlayerRow {
  name: string;
  majority: number;
  decided: number;
  rate: number;
}

/** Group quotes the way buildBracket does, so a conversation quote ranks under
 *  its last speaker rather than as a separate "A, B, C" entity. */
function authorKey(q: { author: string; sortAuthor?: string }): string {
  return q.sortAuthor ?? q.author;
}

export function computeAuthorRanks(bracketHistory: Matchup[][]): AuthorRow[] {
  const reached = new Map<string, number>();
  const entered = new Map<string, Set<string>>();
  let championAuthor: string | null = null;

  bracketHistory.forEach((round, rIdx) => {
    const roundNo = rIdx + 1;
    for (const m of round) {
      for (const side of ['a', 'b'] as const) {
        const q = m[side];
        if (!q || q.author === 'Unknown') continue;
        const key = authorKey(q);
        reached.set(key, Math.max(reached.get(key) ?? 0, roundNo));
        if (!entered.has(key)) entered.set(key, new Set());
        // Dedupe by text: the same quote reappears in every round it survives.
        entered.get(key)!.add(q.text);
      }
    }
  });

  // The champion is the winning side of the single matchup in the last round.
  const finalRound = bracketHistory[bracketHistory.length - 1];
  if (finalRound && finalRound.length === 1) {
    const m = finalRound[0];
    const q = m.winner === 'a' ? m.a : m.winner === 'b' ? m.b : null;
    if (q && q.author !== 'Unknown') championAuthor = authorKey(q);
  }

  return Array.from(reached.entries())
    .map(([author, r]) => ({
      author,
      reached: r,
      entered: entered.get(author)?.size ?? 0,
      champion: author === championAuthor,
    }))
    .sort((x, y) =>
      // Champion first, then depth, then who got more quotes that far, then name.
      Number(y.champion) - Number(x.champion) ||
      y.reached - x.reached ||
      y.entered - x.entered ||
      x.author.localeCompare(y.author));
}

export function computePlayerRanks(bracketHistory: Matchup[][]): PlayerRow[] {
  const majority = new Map<string, number>();
  const decided = new Map<string, number>();

  const bump = (map: Map<string, number>, k: string) => map.set(k, (map.get(k) ?? 0) + 1);

  for (const round of bracketHistory) {
    for (const m of round) {
      if (m.a === null || m.b === null) continue;  // a BYE was never voted on
      const a = m.votes.a.length;
      const b = m.votes.b.length;
      if (a === 0 && b === 0) continue;
      // An exact tie was settled by a coin flip, so it has no majority to be on.
      // Counting it either way would score every voter in a tied matchup as
      // wrong, which is a scoreboard artefact rather than anything they did.
      if (a === b) continue;
      const winningSide = a > b ? 'a' : 'b';
      for (const side of ['a', 'b'] as const) {
        for (const name of m.votes[side]) {
          bump(decided, name);
          if (side === winningSide) bump(majority, name);
        }
      }
    }
  }

  return Array.from(decided.entries())
    .map(([name, d]) => ({
      name,
      majority: majority.get(name) ?? 0,
      decided: d,
      rate: d > 0 ? (majority.get(name) ?? 0) / d : 0,
    }))
    .sort((x, y) => y.rate - x.rate || y.decided - x.decided || x.name.localeCompare(y.name));
}

function Panel({ title, subtitle, empty, className, children }: {
  title: string; subtitle: string; empty: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={`rank-panel${className ? ` ${className}` : ''}`}>
      <p className="rank-title">{title}</p>
      <p className="rank-sub">{subtitle}</p>
      {empty
        ? <p className="rank-empty">Not enough votes to rank.</p>
        : <ol className="rank-list">{children}</ol>}
    </div>
  );
}

export default function WinRankings({ bracketHistory }: Props) {
  const authors = computeAuthorRanks(bracketHistory);
  const players = computePlayerRanks(bracketHistory);

  return (
    <div className="rank-split mt-3">
      <Panel
        className="win-panel"
        title="Author standings"
        subtitle="How far the author's best quote got"
        empty={authors.length === 0}
      >
        {authors.map((a, i) => (
          <li
            key={a.author}
            className={`rank-row win-row${i === 0 ? ' rank-row-top' : ''}`}
            style={{ ['--stagger-index' as string]: i }}
          >
            <span className="rank-pos">{i + 1}</span>
            <span className="rank-name">{a.author}</span>
            <span className="rank-note">
              {a.champion ? '🏆 Champion' : `Round ${a.reached}`}
            </span>
          </li>
        ))}
      </Panel>

      <Panel
        className="win-panel win-panel-second"
        title="Player standings"
        subtitle="How often the player voted with the majority"
        empty={players.length === 0}
      >
        {players.map((p, i) => (
          <li
            key={p.name}
            className={`rank-row win-row${i === 0 ? ' rank-row-top' : ''}`}
            style={{ ['--stagger-index' as string]: i }}
          >
            <span className="rank-pos">{i + 1}</span>
            <span className="rank-name">{p.name}</span>
            {/* The bar is decorative; the number beside it carries the value. */}
            <span className="rank-bar" aria-hidden="true">
              <span
                className="rank-bar-fill win-bar"
                style={{
                  ['--bar-width' as string]: `${(p.rate * 100).toFixed(1)}%`,
                  ['--stagger-index' as string]: i,
                }}
              />
            </span>
            <span className="rank-note">
              {Math.round(p.rate * 100)}%
              <span className="rank-frac"> {p.majority}/{p.decided}</span>
            </span>
          </li>
        ))}
      </Panel>
    </div>
  );
}
