'use client';

import { useEffect, useRef, useState } from 'react';

interface Props { va: number; vb: number; }

/** Flashes its value accent whenever that value changes. Votes arrive on the
 *  host's 2s poll, so each change is a discrete event worth marking rather than
 *  a continuous stream. */
function VoteCount({ value, className }: { value: number; className: string }) {
  const [flash, setFlash] = useState(false);
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setFlash(true);
    }
  }, [value]);

  return (
    <span
      className={`${className}${flash ? ' m-value-flash' : ''}`}
      onAnimationEnd={() => setFlash(false)}
    >
      {value}
    </span>
  );
}

export default function VoteBar({ va, vb }: Props) {
  const total = va + vb;
  const pct = total > 0 ? Math.round((va / total) * 100) : 50;
  return (
    <div className="vote-bar-row">
      <VoteCount value={va} className="vote-count" />
      <div className="vote-bar-track">
        <div className="vote-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <VoteCount value={vb} className="vote-count right" />
    </div>
  );
}
