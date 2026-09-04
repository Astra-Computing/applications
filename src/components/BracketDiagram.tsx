'use client';

import { memo, useRef, useEffect } from 'react';
import { prefersReducedMotion } from '@/lib/useAnimatedNumber';
import { Matchup, Quote } from '@/lib/types';
import { truncate, getVoteCounts } from '@/lib/gameLogic';

interface Props {
  rounds: Matchup[][];   // [bracketHistory[0], ..., currentMatchups]
  currentRound: number;
  /** False while the results slideshow covers the screen. The bracket renders
   *  underneath a position:fixed inset:0 opaque overlay during `results`, so an
   *  entrance played on arrival would finish unseen (KTD9). */
  revealed?: boolean;
}

// Layout constants
const SLOT_H = 76;   // Vertical space per first-round slot
const BOX_W = 190;
const BOX_H = 60;
const ROUND_GAP = 50;
const ROUND_STEP = BOX_W + ROUND_GAP;
const PAD_X = 16;
const PAD_Y = 20;

function matchupCenterY(matchupIdx: number, roundIdx: number, firstRoundCount: number): number {
  // Each matchup in round r spans 2^r first-round slots
  const slotsPerMatchup = Math.pow(2, roundIdx);
  return PAD_Y + (matchupIdx + 0.5) * slotsPerMatchup * SLOT_H;
}

function BracketDiagram({ rounds, currentRound, revealed = true }: Props) {
  // Hooks must run before any early return - the previous order (return null
  // above useRef/useEffect) is a rules-of-hooks violation that throws
  // "Rendered more hooks than during the previous render" the first time this
  // component is rendered with an empty `rounds` and then a non-empty one.
  const scrollRef = useRef<HTMLDivElement>(null);
  const isEmpty = rounds.length === 0 || rounds[0].length === 0;

  // Travel to the rightmost column whenever a new round is added (R22).
  //
  // This is a script-driven scroll, so no prefers-reduced-motion rule in the
  // stylesheet can reach it - the guard has to live here (KTD6). Held until
  // `revealed` so it does not run behind the slideshow.
  useEffect(() => {
    if (isEmpty || !revealed) return;
    const el = scrollRef.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.scrollLeft = el.scrollWidth;
      return;
    }
    el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
  }, [rounds.length, isEmpty, revealed]);

  // Guards an empty first round too: Math.max() over no elements is -Infinity,
  // which propagates into the SVG height as NaN.
  if (isEmpty) return null;

  const firstRoundCount = rounds[0].length;

  // Pre-compute the effective center Y for every matchup.
  // When a matchup's only feeder from the previous round is a lone BYE box,
  // this matchup is repositioned to that BYE box's actual Y — keeping the
  // first-round spacing intact and producing a straight horizontal connector.
  // Built row-by-row so chained BYEs inherit the already-adjusted Y rather
  // than the formula default (which would place them progressively too low).
  // Which matchups in round r feed each matchup in round r+1.
  //
  // This used to be `Math.floor(mIdx / 2)`, which assumed winners carry forward
  // in order and that a lone BYE feeder is always the last box. Neither holds
  // now that the BYE is chosen at random, so each winner is located in the next
  // round by identity instead.
  const quoteKey = (q: Quote) => `${q.author}|${q.text}`;
  const feeders: number[][][] = rounds.map(() => []);
  for (let rIdx = 0; rIdx < rounds.length - 1; rIdx++) {
    const nextRound = rounds[rIdx + 1];
    const indexOfQuote = new Map<string, number>();
    nextRound.forEach((m, i) => {
      if (m.a) indexOfQuote.set(quoteKey(m.a), i);
      if (m.b) indexOfQuote.set(quoteKey(m.b), i);
    });
    feeders[rIdx + 1] = nextRound.map(() => []);
    rounds[rIdx].forEach((m, mIdx) => {
      const won = m.winner ? m[m.winner] : null;
      if (!won) return;
      const target = indexOfQuote.get(quoteKey(won));
      if (target !== undefined) feeders[rIdx + 1][target].push(mIdx);
    });
  }

  // A matchup sits at the mean of the boxes feeding it. For an ordinary pair
  // that is exactly the old formula; for a lone feeder it puts the box level
  // with its one source, which is the straight connector the special case above
  // was hand-computing. Unresolved rounds have no feeders and keep the formula.
  const cyGrid: number[][] = [];
  for (let rIdx = 0; rIdx < rounds.length; rIdx++) {
    const row: number[] = [];
    for (let mIdx = 0; mIdx < rounds[rIdx].length; mIdx++) {
      const from = rIdx > 0 ? (feeders[rIdx][mIdx] ?? []) : [];
      if (from.length > 0) {
        const sum = from.reduce((acc, f) => acc + cyGrid[rIdx - 1][f], 0);
        row.push(sum / from.length);
      } else {
        row.push(matchupCenterY(mIdx, rIdx, firstRoundCount));
      }
    }
    cyGrid.push(row);
  }

  // SVG dimensions — lone feeders may sit below the default first-round height
  const maxCy = Math.max(...cyGrid.flat());
  const totalHeight = maxCy + BOX_H / 2 + PAD_Y;
  const totalWidth = rounds.length * ROUND_STEP - ROUND_GAP + PAD_X * 2;

  const boxes: React.ReactNode[] = [];
  const lines: React.ReactNode[] = [];

  rounds.forEach((round, rIdx) => {
    const x = PAD_X + rIdx * ROUND_STEP;
    const isCurrentRound = rIdx === rounds.length - 1;

    round.forEach((m, mIdx) => {
      const cy = cyGrid[rIdx][mIdx];
      const y = cy - BOX_H / 2;

      // Determine display info
      const isBye = m.a === null || m.b === null;
      const [va, vb] = getVoteCounts(m);
      const hasVotes = va + vb > 0;
      const isCompleted = !isCurrentRound || m.winner !== null;

      const borderColor = isBye
        ? 'var(--border)'
        : isCompleted
          ? 'var(--accent)'
          : hasVotes
            ? '#3a5a8a'
            : 'var(--border)';

      const winnerSide = m.winner;
      const labelA = m.a ? truncate(m.a.text, 22) : '—';
      const labelB = m.b ? truncate(m.b.text, 22) : 'BYE';

      const aWon = winnerSide === 'a';
      const bWon = winnerSide === 'b';
      const aColor = isCompleted ? (aWon ? '#e8e6e1' : '#444') : hasVotes && va > vb ? 'var(--accent)' : '#aaa';
      const bColor = isCompleted ? (bWon ? '#e8e6e1' : '#444') : hasVotes && vb > va ? 'var(--accent)' : '#aaa';

      // Only the newest column animates in: every earlier column keeps the
      // exact coordinates it already had, so there is nothing there to move.
      const entering = revealed && isCurrentRound && rounds.length > 1;
      boxes.push(
        <g
          key={`box-${rIdx}-${mIdx}`}
          className={entering ? 'bracket-enter' : undefined}
          style={entering ? { ['--stagger-index' as string]: mIdx } : undefined}
        >
          {/* Background */}
          <rect
            x={x} y={y}
            width={BOX_W} height={BOX_H}
            rx={7}
            fill="var(--card-bg)"
            stroke={borderColor}
            strokeWidth={1.5}
            className={isCurrentRound && !isCompleted ? 'bracket-active' : undefined}
          />
          {/* Divider line */}
          <line x1={x + 8} y1={cy} x2={x + BOX_W - 8} y2={cy} stroke="var(--border)" strokeWidth={1} />

          {/* Quote A (top half) */}
          <text x={x + 10} y={y + 20} fontSize={11} fill={aColor} fontFamily="var(--font-serif)">
            {labelA}
          </text>
          {isCompleted && aWon && (
            <text x={x + BOX_W - 20} y={y + 20} fontSize={10} fill="var(--accent)" textAnchor="end">✓</text>
          )}
          {hasVotes && !isBye && (
            <text x={x + BOX_W - 10} y={y + 19} fontSize={9} fill={aColor} textAnchor="end">{va}</text>
          )}

          {/* Quote B (bottom half) */}
          <text x={x + 10} y={cy + 19} fontSize={11} fill={bColor} fontFamily="var(--font-serif)">
            {labelB}
          </text>
          {isCompleted && bWon && (
            <text x={x + BOX_W - 20} y={cy + 19} fontSize={10} fill="var(--accent)" textAnchor="end">✓</text>
          )}
          {hasVotes && !isBye && (
            <text x={x + BOX_W - 10} y={cy + 19} fontSize={9} fill={bColor} textAnchor="end">{vb}</text>
          )}

          {/* Round label above first row */}
          {mIdx === 0 && (
            <text x={x + BOX_W / 2} y={y - 8} fontSize={10} fill="var(--muted-dark)" textAnchor="middle" fontFamily="var(--font-sans)">
              {`Round ${currentRound - (rounds.length - 1 - rIdx)}`}
            </text>
          )}
        </g>
      );

      // Connector lines to the next round.
      //
      // Drawn once per NEXT-round box rather than once per pair of current
      // boxes: with a randomised BYE a box can have one feeder or two, and
      // those feeders are no longer guaranteed to be adjacent.
      if (rIdx < rounds.length - 1) {
        const midX = x + BOX_W + ROUND_GAP / 2;
        const nextX = PAD_X + (rIdx + 1) * ROUND_STEP;

        rounds[rIdx + 1].forEach((_next, nextMIdx) => {
          const from = feeders[rIdx + 1][nextMIdx] ?? [];
          if (from.indexOf(mIdx) === -1) return;
          const nextCy = cyGrid[rIdx + 1][nextMIdx];

          // This box out to the shared vertical.
          lines.push(
            <line key={`line-h-${rIdx}-${mIdx}`}
              x1={x + BOX_W} y1={cy} x2={midX} y2={cy}
              stroke="var(--border)" strokeWidth={1.5}
            />
          );

          // The vertical and the run into the next box belong to the target,
          // not to either feeder, so only the first feeder draws them.
          if (from[0] !== mIdx) return;
          if (from.length > 1) {
            const ys = from.map(f => cyGrid[rIdx][f]);
            lines.push(
              <line key={`line-v-${rIdx}-${nextMIdx}`}
                x1={midX} y1={Math.min(...ys)} x2={midX} y2={Math.max(...ys)}
                stroke="var(--border)" strokeWidth={1.5}
              />
            );
          }
          lines.push(
            <line key={`line-h2-${rIdx}-${nextMIdx}`}
              x1={midX} y1={nextCy} x2={nextX} y2={nextCy}
              stroke="var(--border)" strokeWidth={1.5}
            />
          );
        });
      }
    });
  });

  return (
    <div ref={scrollRef} className="bracket-scroll" style={{ overflowX: 'auto', overflowY: 'hidden', marginBottom: '1rem' }}>
      <svg
        width={totalWidth}
        height={totalHeight}
        role="img"
        aria-label={`Tournament bracket, ${rounds.length} round${rounds.length === 1 ? '' : 's'}, currently on round ${currentRound}`}
        style={{ display: 'block', fontFamily: 'var(--font-sans)' }}
      >
        {lines}
        {boxes}
      </svg>
    </div>
  );
}

// The host page re-renders every 2s from its poll; with a referentially stable
// `rounds` (memoized upstream) this skips re-diffing the whole SVG.
export default memo(BracketDiagram);
