'use client';

import { CSSProperties, useEffect, useRef, useState } from 'react';
import { Matchup, Quote } from '@/lib/types';
import { getVoteCounts } from '@/lib/gameLogic';
import QuoteCard from '@/components/QuoteCard';

// 5s a slide: long enough to read both quotes and watch the fill settle,
// short enough that a 16-matchup opening round doesn't outstay its welcome.
// The 2s rise itself lives in globals.css (`results-fill`).
const SLIDE_MS = 5000;

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
        <div className="slide-fill" style={{ '--fill-height': fill } as CSSProperties} />
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

  useEffect(() => {
    if (total === 0) { finishRef.current(); return; }
    const timer = setTimeout(() => {
      if (index + 1 < total) setIndex(i => i + 1);
      else finishRef.current();
    }, SLIDE_MS);
    return () => clearTimeout(timer);
  }, [index, total]);

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
    <div ref={rootRef} className="slideshow" role="region" aria-label="Round results" tabIndex={-1}>
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
