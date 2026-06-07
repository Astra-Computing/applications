'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { GameStatePublic, MatchupPublic } from '@/lib/types';
import { truncate } from '@/lib/gameLogic';
import QuoteCard from '@/components/QuoteCard';
import BuyMeACoffee from '@/components/BuyMeACoffee';

const Confetti = dynamic(() => import('@/components/Confetti'), { ssr: false });

const HEARTBEAT_MS = 8000;

// ── SVG pie chart helpers ───────────────────────────────────────────────────

const PIE_R  = 65;
const PIE_CX = 75;
const PIE_CY = 75;

function polarXY(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function slicePath(cx: number, cy: number, r: number, a1: number, a2: number): string {
  const s = polarXY(cx, cy, r, a1);
  const e = polarXY(cx, cy, r, a2);
  const large = (a2 - a1) > Math.PI ? 1 : 0;
  return `M${cx},${cy} L${s.x},${s.y} A${r},${r} 0 ${large} 1 ${e.x},${e.y} Z`;
}

interface PieChartProps { popular: number; total: number; }

function VotingPieChart({ popular, total }: PieChartProps) {
  if (total === 0) {
    return <p className="text-sm text-muted">No votes recorded.</p>;
  }

  const popularPct   = Math.round((popular / total) * 100);
  const unpopularPct = 100 - popularPct;
  const startA = -Math.PI / 2;
  const splitA = startA + (popular / total) * 2 * Math.PI;
  const hasBoth = popular > 0 && popular < total;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
      <svg width={150} height={150} style={{ flexShrink: 0 }}>
        <circle cx={PIE_CX} cy={PIE_CY} r={PIE_R} fill="var(--card-bg)" stroke="var(--border)" strokeWidth={1.5} />
        {popular === total && (
          <circle cx={PIE_CX} cy={PIE_CY} r={PIE_R} fill="var(--accent)" stroke="var(--border)" strokeWidth={1.5} />
        )}
        {hasBoth && (
          <path d={slicePath(PIE_CX, PIE_CY, PIE_R, startA, splitA)} fill="var(--accent)" />
        )}
        {hasBoth && (() => {
          const top   = polarXY(PIE_CX, PIE_CY, PIE_R, startA);
          const split = polarXY(PIE_CX, PIE_CY, PIE_R, splitA);
          return (
            <>
              <line x1={PIE_CX} y1={PIE_CY} x2={top.x}   y2={top.y}   stroke="var(--bg)" strokeWidth={2} />
              <line x1={PIE_CX} y1={PIE_CY} x2={split.x} y2={split.y} stroke="var(--bg)" strokeWidth={2} />
            </>
          );
        })()}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--accent)', flexShrink: 0 }} />
          <span className="text-sm">Popular: <strong>{popularPct}%</strong></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--card-bg)', border: '1px solid var(--border)', flexShrink: 0 }} />
          <span className="text-sm">Unpopular: <strong>{unpopularPct}%</strong></span>
        </div>
        <p className="text-xs text-muted" style={{ marginTop: '0.2rem' }}>
          {popular} of {total} votes
        </p>
      </div>
    </div>
  );
}

// ── Main player view ────────────────────────────────────────────────────────

function PlayerView() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();

  const [name, setName]               = useState('');
  const [playerToken, setPlayerToken] = useState('');
  const [state, setState]             = useState<GameStatePublic | null>(null);
  const [error, setError]             = useState('');
  const [voting, setVoting]           = useState<Record<number, boolean>>({});
  const esRef        = useRef<EventSource | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Read session from sessionStorage (client-only)
  useEffect(() => {
    const raw = sessionStorage.getItem(`uq_session_${code}`);
    if (!raw) { router.replace(`/join?code=${code}`); return; }
    const session = JSON.parse(raw) as { name: string; token: string };
    setName(session.name);
    setPlayerToken(session.token);
  }, [code, router]);

  useEffect(() => {
    if (!name || !playerToken) return;

    const es = new EventSource(
      `/api/game/${code}/stream?playerToken=${encodeURIComponent(playerToken)}&playerName=${encodeURIComponent(name)}`
    );
    es.onmessage = (e) => {
      try { setState(JSON.parse(e.data)); } catch {}
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setError('Connection lost.');
    };
    esRef.current = es;

    heartbeatRef.current = setInterval(() => {
      fetch(`/api/game/${code}/heartbeat`, {
        method: 'POST',
        headers: { 'x-player-token': playerToken, 'x-player-name': name },
      });
    }, HEARTBEAT_MS);

    return () => {
      es.close();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [code, name, playerToken]);

  useEffect(() => {
    if (state?.status === 'done') {
      esRef.current?.close();
      esRef.current = null;
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [state?.status]);

  async function vote(matchupIndex: number, choice: 'a' | 'b') {
    setVoting(v => ({ ...v, [matchupIndex]: true }));
    try {
      await fetch(`/api/game/${code}/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-player-token': playerToken,
          'x-player-name': name,
        },
        body: JSON.stringify({ matchupIndex, choice }),
      });
    } finally {
      setVoting(v => ({ ...v, [matchupIndex]: false }));
    }
  }

  if (error) return (
    <main className="page">
      <div className="alert alert-error">{error}</div>
      <button className="btn mt-3" onClick={() => router.push('/')}>Go Home</button>
    </main>
  );
  if (!state || !name) return <main className="page"><p className="text-muted waiting-shimmer">Connecting…</p></main>;

  return (
    <main className="page">
      <div style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.6rem', marginBottom: '0.25rem' }}>[UN]Quotable</h2>
        <p className="text-sm text-muted">
          Room <strong style={{ color: 'var(--text)' }}>{code}</strong>
          {' · '}Playing as <strong style={{ color: 'var(--text)' }}>{name}</strong>
        </p>
      </div>
      <hr />

      {/* Lobby */}
      {state.status === 'lobby' && (
        <div className="text-center" style={{ padding: '3rem 0' }}>
          <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>You're in! ✓</p>
          <p className="text-muted waiting-shimmer">Waiting for the host to start…</p>
        </div>
      )}

      {/* Voting */}
      {state.status === 'voting' && (() => {
        const realMatchups = state.matchups.filter((m: MatchupPublic) => m.a && m.b);
        const voteCount = realMatchups.filter((m: MatchupPublic) => m.myVote !== null).length;

        return (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem' }}>
              <h3 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: '1.05rem' }}>
                Round {state.round} — Vote!
              </h3>
              <span className="text-sm text-muted">{voteCount}/{realMatchups.length} cast</span>
            </div>
            <p className="text-xs text-muted mb-2">Quotes are anonymous. Vote for whichever speaks to you.</p>

            {state.matchups.map((m: MatchupPublic, i: number) => {
              if (!m.a || !m.b) return null;
              const pick = m.myVote;
              return (
                <div key={i} style={{ marginBottom: '2rem' }}>
                  <p className="match-header">Match {i + 1}</p>
                  <div className="grid-3">
                    <div className="flex-col" style={{ gap: '0.5rem' }}>
                      <QuoteCard quote={m.a} selected={pick === 'a'} />
                      <button
                        className={`btn${pick === 'a' ? ' btn-primary' : ''} btn-full${voting[i] ? ' waiting-shimmer' : ''}`}
                        onClick={() => vote(i, 'a')}
                        disabled={voting[i]}
                      >
                        {pick === 'a' ? '✓ Your pick' : 'Vote for this'}
                      </button>
                    </div>

                    <div className="vs-label">vs</div>

                    <div className="flex-col" style={{ gap: '0.5rem' }}>
                      <QuoteCard quote={m.b} selected={pick === 'b'} />
                      <button
                        className={`btn${pick === 'b' ? ' btn-primary' : ''} btn-full${voting[i] ? ' waiting-shimmer' : ''}`}
                        onClick={() => vote(i, 'b')}
                        disabled={voting[i]}
                      >
                        {pick === 'b' ? '✓ Your pick' : 'Vote for this'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {voteCount === realMatchups.length && (
              <div className="alert alert-success"><span className="waiting-shimmer">All votes cast! Waiting for the host…</span></div>
            )}
          </>
        );
      })()}

      {/* Results */}
      {state.status === 'results' && (
        <>
          <h3 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, marginBottom: '0.75rem', fontSize: '1.05rem' }}>
            Results are in!
          </h3>
          {state.bracketHistory.length > 0 && (
            <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
              {state.bracketHistory[state.bracketHistory.length - 1].map((m: MatchupPublic, i: number) => {
                if (!m.a || !m.b) return null;
                const ws = m.winner ?? 'a';
                const w = m[ws]!;
                const votes = ws === 'a' ? m.votes.a : m.votes.b;
                const lost  = ws === 'a' ? m.votes.b : m.votes.a;
                return (
                  <p key={i} className="text-sm" style={{ padding: '0.25rem 0', borderBottom: '1px solid var(--border)' }}>
                    ✓ <em>"{truncate(w.text, 70)}"</em>
                    <span className="text-muted"> {votes}–{lost}</span>
                  </p>
                );
              })}
            </div>
          )}
          <div className="alert alert-info"><span className="waiting-shimmer">Waiting for host to start next round…</span></div>
        </>
      )}

      {/* Done */}
      {state.status === 'done' && state.champion && (() => {
        let popular = 0, total = 0;
        for (const round of state.bracketHistory) {
          for (const m of round as MatchupPublic[]) {
            if (!m.a || !m.b || !m.winner || !m.myVote) continue;
            total++;
            if (m.myVote === m.winner) popular++;
          }
        }

        return (
          <>
            <Confetti />

            <div className="champion-card">
              <div className="champion-label">🏆 Champion</div>
              <div className="champion-quote">"{state.champion!.text}"</div>
              {state.champion!.author && (
                <div className="champion-author">— {state.champion!.author}</div>
              )}
            </div>

            <div className="card mt-3" style={{ padding: '1.25rem' }}>
              <h3 style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: '0.95rem',
                marginBottom: '1rem',
                color: 'var(--text)',
              }}>
                Voting History:
              </h3>
              <VotingPieChart popular={popular} total={total} />
            </div>

            <button className="btn mt-3" onClick={() => router.push('/')}>↺ New Game</button>
            <BuyMeACoffee />
          </>
        );
      })()}
    </main>
  );
}

export default function PlayerPage() {
  return (
    <Suspense fallback={<main className="page"><p className="text-muted">Loading…</p></main>}>
      <PlayerView />
    </Suspense>
  );
}
