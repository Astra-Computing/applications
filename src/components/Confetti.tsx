'use client';
import { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { prefersReducedMotion } from '@/lib/useAnimatedNumber';

const COLORS = ['#4f8ef7', '#f0c060', '#e8e6e1', '#7db0f5', '#f5d080'];

/** How long the drift after the opening volley runs. */
const SHOWER_MS = 6000;

export default function Confetti() {
  useEffect(() => {
    // This draws to a canvas from script, so no prefers-reduced-motion rule in
    // globals.css can suppress it. R31's "no confetti fires" clause lives here
    // and nowhere else.
    if (prefersReducedMotion()) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    let showerFrame: number | null = null;

    const fire = (opts: confetti.Options) =>
      confetti({ colors: COLORS, gravity: 0.85, decay: 0.91, ticks: 220, ...opts });

    // Left burst
    fire({ particleCount: 75, angle: 60,  spread: 55, origin: { x: 0.1, y: 0.9 }, startVelocity: 62 });
    // Right burst (slight delay)
    timers.push(setTimeout(() =>
      fire({ particleCount: 75, angle: 120, spread: 55, origin: { x: 0.9, y: 0.9 }, startVelocity: 62 }),
    150));
    // Centre follow-up
    timers.push(setTimeout(() =>
      fire({ particleCount: 55, angle: 90,  spread: 72, origin: { x: 0.5, y: 1.0 }, startVelocity: 68 }),
    350));

    // Then a slow drift from the top edge, so the celebration lingers under the
    // standings instead of ending before the host has read them. Low particle
    // counts per frame rather than one huge burst - the screen stays legible.
    const showerStart = performance.now() + 600;
    function shower(now: number) {
      const elapsed = now - showerStart;
      if (elapsed > SHOWER_MS) { showerFrame = null; return; }
      if (elapsed > 0) {
        confetti({
          colors: COLORS,
          particleCount: 2,
          startVelocity: 0,
          gravity: 0.42,
          decay: 0.94,
          ticks: 320,
          spread: 90,
          scalar: 0.85,
          origin: { x: Math.random(), y: -0.05 },
        });
      }
      showerFrame = requestAnimationFrame(shower);
    }
    showerFrame = requestAnimationFrame(shower);

    return () => {
      timers.forEach(clearTimeout);
      if (showerFrame !== null) cancelAnimationFrame(showerFrame);
    };
  }, []);

  return null;
}
