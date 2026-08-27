'use client';

import { memo, useRef, useEffect } from 'react';
import { Matchup } from '@/lib/types';
import { truncate, getVoteCounts } from '@/lib/gameLogic';

interface Props {
  rounds: Matchup[][];   // [bracketHistory[0], ..., currentMatchups]
  currentRound: number;
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

function BracketDiagram({ rounds, currentRound }: Props) {
  // Hooks must run before any early return - the previous order (return null
  // above useRef/useEffect) is a rules-of-hooks violation that throws
  // "Rendered more hooks than during the previous render" the first time this
  // component is rendered with an empty `rounds` and then a non-empty one.
  const scrollRef = useRef<HTMLDivElement>(null);
  const isEmpty = rounds.length === 0 || rounds[0].length === 0;

  // Scroll to the rightmost column whenever a new round is added
  useEffect(() => {
    if (isEmpty) return;
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [rounds.length, isEmpty]);

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
  const cyGrid: number[][] = [];
  for (let rIdx = 0; rIdx < rounds.length; rIdx++) {
    const row: number[] = [];
    for (let mIdx = 0; mIdx < rounds[rIdx].length; mIdx++) {
      if (rIdx > 0) {
        const loneFeederIdx = 2 * mIdx;
        if (rounds[rIdx - 1].length === loneFeederIdx + 1) {
          row.push(cyGrid[rIdx - 1][loneFeederIdx]);
          continue;
        }
      }
      row.push(matchupCenterY(mIdx, rIdx, firstRoundCount));
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

      boxes.push(
        <g key={`box-${rIdx}-${mIdx}`}>
          {/* Background */}
          <rect
            x={x} y={y}
            width={BOX_W} height={BOX_H}
            rx={7}
            fill="var(--card-bg)"
            stroke={borderColor}
            strokeWidth={1.5}
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

      // Connector lines to next round
      if (rIdx < rounds.length - 1) {
        const nextRound = rounds[rIdx + 1];
        const nextMIdx = Math.floor(mIdx / 2);
        if (nextMIdx < nextRound.length) {
          const nextCy = cyGrid[rIdx + 1][nextMIdx];
          const midX = x + BOX_W + ROUND_GAP / 2;

          // Horizontal from this box's right edge to midX
          lines.push(
            <line key={`line-h-${rIdx}-${mIdx}`}
              x1={x + BOX_W} y1={cy} x2={midX} y2={cy}
              stroke="var(--border)" strokeWidth={1.5}
            />
          );

          // Vertical at midX — only for paired matchups; lone feeders are already at nextCy
          if (mIdx % 2 === 0 && mIdx + 1 < round.length) {
            const siblingCy = cyGrid[rIdx][mIdx + 1];
            lines.push(
              <line key={`line-v-${rIdx}-${mIdx}`}
                x1={midX} y1={cy} x2={midX} y2={siblingCy}
                stroke="var(--border)" strokeWidth={1.5}
              />
            );
          }

          // Horizontal from midX to next box's left edge (once per pair, on even index)
          if (mIdx % 2 === 0) {
            const nextX = PAD_X + (rIdx + 1) * ROUND_STEP;
            lines.push(
              <line key={`line-h2-${rIdx}-${mIdx}`}
                x1={midX} y1={nextCy} x2={nextX} y2={nextCy}
                stroke="var(--border)" strokeWidth={1.5}
              />
            );
          }
        }
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
