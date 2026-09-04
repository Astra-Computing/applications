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

    // Tuned for something a room actually notices. The previous values fired
    // from the very bottom edge with a fast decay, so the burst was spent
    // before the eye reached it - the celebration was technically firing and
    // effectively invisible. These come up higher into frame, carry further,
    // and live long enough to be seen.
    const fire = (opts: confetti.Options) =>
      confetti({ colors: COLORS, gravity: 0.9, decay: 0.94, ticks: 320, scalar: 1.1, ...opts });

    // Opening volley: two side cannons and a centre shot.
    fire({ particleCount: 130, angle: 62,  spread: 70, origin: { x: 0.05, y: 0.85 }, startVelocity: 78 });
    timers.push(setTimeout(() =>
      fire({ particleCount: 130, angle: 118, spread: 70, origin: { x: 0.95, y: 0.85 }, startVelocity: 78 }),
    140));
    timers.push(setTimeout(() =>
      fire({ particleCount: 110, angle: 90,  spread: 110, origin: { x: 0.5, y: 0.92 }, startVelocity: 72 }),
    320));
    // One more pair once the first has peaked, so the burst reads as a volley
    // rather than a single pop.
    timers.push(setTimeout(() => {
      fire({ particleCount: 90, angle: 70,  spread: 80, origin: { x: 0.2, y: 0.9 }, startVelocity: 70 });
      fire({ particleCount: 90, angle: 110, spread: 80, origin: { x: 0.8, y: 0.9 }, startVelocity: 70 });
    }, 700));

    // Then a steady fall from the top edge, so the celebration lingers under
    // the standings instead of ending before the host has read them. Spawned
    // just inside the viewport rather than above it - starting off-screen with
    // no velocity meant the drift barely arrived before its lifetime ran out.
    const showerStart = performance.now() + 500;
    function shower(now: number) {
      const elapsed = now - showerStart;
      if (elapsed > SHOWER_MS) { showerFrame = null; return; }
      if (elapsed > 0) {
        confetti({
          colors: COLORS,
          particleCount: 4,
          startVelocity: 12,
          angle: 270,
          gravity: 0.6,
          decay: 0.95,
          ticks: 380,
          spread: 120,
          scalar: 1,
          origin: { x: Math.random(), y: 0 },
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
