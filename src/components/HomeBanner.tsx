'use client';
import { useState, useEffect } from 'react';

const TYPED_TEXT = ' Quotable — The Game';

export default function HomeBanner() {
  const [typed, setTyped] = useState('');
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setStarted(true), 500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!started || typed.length >= TYPED_TEXT.length) return;
    const t = setTimeout(() => {
      setTyped(TYPED_TEXT.slice(0, typed.length + 1));
    }, 70);
    return () => clearTimeout(t);
  }, [started, typed]);

  const isDone = typed.length === TYPED_TEXT.length;

  return (
    <div className="banner-home-wrap">
      <img src="/UQTG001.png" alt="" />
      <div className="banner-title-overlay">
        <div className="banner-title-row">
          <img src="/UQTG004.png" alt="[UN]" className="banner-title-img" />
          <span className="banner-title-typed">
            {typed}
            {started && !isDone && <span className="banner-cursor">_</span>}
          </span>
        </div>
      </div>
    </div>
  );
}
