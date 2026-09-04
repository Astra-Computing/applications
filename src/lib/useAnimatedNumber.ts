'use client';

import { useEffect, useRef, useState } from 'react';

/** True when the viewer asked for reduced motion. Read at call time rather than
 *  cached, so a host who changes the OS setting mid-game is honoured without a
 *  reload. Guarded for SSR, where `window` does not exist. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Counts from the previous value to `target` over `duration` ms.
 *
 * This is JS-driven motion, so no `prefers-reduced-motion` rule in globals.css
 * can reach it - the reduced-motion contract for anything animated from script
 * has to be checked at the callsite. Under reduced motion the hook returns the
 * target immediately and starts no timer at all.
 *
 * Used by the setup-screen quote count, the lobby player count, and the
 * "up next" matchup count.
 */
export function useAnimatedNumber(target: number, duration = 420): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;

    if (prefersReducedMotion() || duration <= 0) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }

    const start = performance.now();
    const delta = target - from;

    function step(now: number) {
      const t = Math.min(1, (now - start) / duration);
      // Ease-out: the number lands softly rather than stopping dead, which is
      // what makes a counter read as settling rather than glitching.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + delta * eased));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
        frameRef.current = null;
      }
    }

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      // Leave the counter wherever it stopped as the new origin, so an
      // interrupted count does not jump backwards on the next change.
      fromRef.current = target;
    };
  }, [target, duration]);

  return display;
}
