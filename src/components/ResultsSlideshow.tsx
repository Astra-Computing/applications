'use client';

import { CSSProperties, useEffect, useRef, useState } from 'react';
import { Matchup, Quote } from '@/lib/types';
import { getVoteCounts } from '@/lib/gameLogic';
import QuoteCard from '@/components/QuoteCard';

// A one-matchup final holds for the full 5s; a big opening round gets 1s a
// slide so the recap doesn't outstay its welcome. 1s is the readable floor —
// below it the fill never reads as a fill.
const SLIDE_MAX_MS = 5000;
const SLIDE_MIN_MS = 1000;

// The rise occupies the first 40% of a slide, the proportion the original
// fixed 2s-of-5s pairing had. Keeping it a ratio means the pour still settles
// with time to spare on a 1s slide instead of being cut off mid-climb.
const FILL_RATIO = 0.4;

/**
 * Slide duration in ms for a round of `n` matchups.
 *
 * Anchored at both ends by design: 5s at one matchup, 1s at twelve. The curve
 * between them is a true inverse (a + b/n), not a straight line, because that
 * keeps the *total* round length linear in n — a six-matchup round lands at
 * ~8.2s, where a linear ramp between the same two anchors would drag it out to
 * ~19s, longer than either endpoint. Clamped so a 256-matchup opening round
 * can't dip under the floor.
 */
export function slideDuration(n: number): number {
  if (n <= 0) return SLIDE_MAX_MS;
  const ms = (7000 + 48000 / n) / 11;
  return Math.min(SLIDE_MAX_MS, Math.max(SLIDE_MIN_MS, ms));
}

// Two full periods across the viewBox, so the 50% drift in `results-wave`
// loops seamlessly: translating by exactly one period lands crest on crest.
// The control points either side of each junction share a direction, which is
// what keeps the joins smooth rather than kinked.
const WAVE_PATH = 'M0,10 C15,2 45,18 60,10 C75,2 105,18 120,10 L120,20 L0,20 Z';

function Wave({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 120 20" preserveAspectRatio="none" aria-hidden="true">
      <path d={WAVE_PATH} />
    </svg>
  );
}

interface Props {
  round: Matchup[];
  onFinish: () => void;
}

interface SideProps {
  quote: Quote | null;
  /** Share of the matchup's total votes, as a CSS length. `null` for a BYE. */
  fill: string | null;
  /** Vote count, or `null` for a BYE — where no vote was ever cast. */
  votes: number | null;
}

function Side({ quote, fill, votes }: SideProps) {
  if (!quote) {
    return (
      <div className="slide-tile slide-tile-empty">
        <span className="slide-empty-label">No opponent</span>
      </div>
    );
  }
  return (
    <div className="slide-tile">
      {fill !== null && (
        <div className="slide-fill" style={{ '--fill-height': fill } as CSSProperties}>
          {/* Two crests riding the water line at different speeds — the same
              parallax idea as the page banners, at a smaller scale. */}
          <Wave className="slide-wave slide-wave-back" />
          <Wave className="slide-wave slide-wave-front" />
        </div>
      )}
      {/* QuoteCard, not a local copy: the quote-wrapping, conversation and
          wrapping rules must stay identical to the voting screen. Author stays
          hidden (showAuthor defaults to false) until the champion reveal. */}
      <QuoteCard quote={quote} />
      <div className="slide-score">
        {votes === null
          ? <span className="slide-score-bye">BYE</span>
          : <>
              <span className="slide-score-num">{votes}</span>
              <span className="slide-score-label">vote{votes === 1 ? '' : 's'}</span>
            </>}
      </div>
    </div>
  );
}

export default function ResultsSlideshow({ round, onFinish }: Props) {
  const [index, setIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // The host page re-renders every 2s on the poll tick, handing us a fresh
  // `onFinish` each time. Keeping it in a ref means the slide timer below
  // depends only on the index, so a poll can never restart the current slide.
  const finishRef = useRef(onFinish);
  useEffect(() => { finishRef.current = onFinish; }, [onFinish]);

  const total = round.length;
  const slideMs = slideDuration(total);
  const fillMs = Math.round(slideMs * FILL_RATIO);

  useEffect(() => {
    if (total === 0) { finishRef.current(); return; }
    const timer = setTimeout(() => {
      if (index + 1 < total) setIndex(i => i + 1);
      else finishRef.current();
    }, slideMs);
    return () => clearTimeout(timer);
  }, [index, total, slideMs]);

  // Space skips straight to the bracket. Captured on the window so a control
  // that still holds focus can't swallow it, and default-prevented on both
  // keydown and keyup so the page never scrolls and no focused button is
  // activated on the way out.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      e.preventDefault();
      if (e.type === 'keydown') finishRef.current();
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, []);

  // Move focus off whatever the host just clicked and onto the presentation.
  useEffect(() => { rootRef.current?.focus(); }, []);

  const m = round[index];
  if (!m) return null;

  // Counts come from the resolved matchup the server already produced. Both
  // sides share one denominator - the votes cast in this matchup - so 7-3
  // reads as 70 % / 30 %, never two independently normalised bars.
  const [va, vb] = getVoteCounts(m);
  const isBye = m.a === null || m.b === null;
  const castTotal = va + vb;
  const share = (v: number) => (castTotal > 0 ? `${((v / castTotal) * 100).toFixed(1)}%` : '0%');

  return (
    <div
      ref={rootRef}
      className="slideshow"
      role="region"
      aria-label="Round results"
      tabIndex={-1}
      style={{ '--fill-dur': `${fillMs}ms` } as CSSProperties}
    >
      <div key={index} className="slideshow-stage matchup-enter" aria-live="polite">
        <Side quote={m.a} fill={isBye ? null : share(va)} votes={isBye ? null : va} />
        <Side quote={m.b} fill={isBye ? null : share(vb)} votes={isBye ? null : vb} />
      </div>
      <p className="slideshow-footer text-xs text-muted">
        {index + 1} / {total} — press Space to skip
      </p>
    </div>
  );
}
