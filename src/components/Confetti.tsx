'use client';
import { useEffect } from 'react';
import confetti from 'canvas-confetti';

const COLORS = ['#4f8ef7', '#f0c060', '#e8e6e1', '#7db0f5', '#f5d080'];

export default function Confetti() {
  useEffect(() => {
    const fire = (opts: confetti.Options) =>
      confetti({ colors: COLORS, gravity: 0.85, decay: 0.91, ticks: 220, ...opts });

    // Left burst
    fire({ particleCount: 75, angle: 60,  spread: 55, origin: { x: 0.1, y: 0.9 }, startVelocity: 62 });
    // Right burst (slight delay)
    setTimeout(() =>
      fire({ particleCount: 75, angle: 120, spread: 55, origin: { x: 0.9, y: 0.9 }, startVelocity: 62 }),
    150);
    // Centre follow-up
    setTimeout(() =>
      fire({ particleCount: 55, angle: 90,  spread: 72, origin: { x: 0.5, y: 1.0 }, startVelocity: 68 }),
    350);
  }, []);

  return null;
}
