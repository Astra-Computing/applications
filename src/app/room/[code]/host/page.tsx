'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { GameState, Matchup } from '@/lib/types';
import { allVoted, getVoteCounts, truncate, PLAYER_TIMEOUT_MS } from '@/lib/gameLogic';
import QuoteCard from '@/components/QuoteCard';
import VoteBar from '@/components/VoteBar';
import BuyMeACoffee from '@/components/BuyMeACoffee';

const QRCode        = dynamic(() => import('react-qr-code'), { ssr: false });
const BracketDiagram = dynamic(() => import('@/components/BracketDiagram'), { ssr: false });
const Confetti      = dynamic(() => import('@/components/Confetti'), { ssr: false });

export default function HostPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [state, setState]           = useState<GameState | null>(null);
  const [error, setError]           = useState('');
  const [acting, setActing]         = useState(false);
  const [joinUrl, setJoinUrl]       = useState('');
  const [hostToken, setHostToken]   = useState('');
  const [skipTutorial, setSkipTutorial] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failCountRef = useRef(0);

  useEffect(() => {
    setJoinUrl(`${window.location.origin}/join?code=${code}`);
    setHostToken(sessionStorage.getItem(`uq_host_${code}`) ?? '');
  }, [code]);

  useEffect(() => {
    if (!hostToken) return;

    let cancelled = false;
    let inFlight  = false;

    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/game/${code}`, { headers: { 'x-host-token': hostToken } });
        if (cancelled) return;
        if (res.ok) {
          failCountRef.current = 0;
          setState(await res.json());
        } else if (res.status === 404) {
          setError('Room not found.');
        } else if (++failCountRef.current >= 3) {
          setError('Connection lost.');
        }
      } catch {
        if (!cancelled && ++failCountRef.current >= 3) setError('Connection lost.');
      } finally {
        inFlight = false;
      }
    }

    poll();
    pollRef.current = setInterval(poll, 2000);

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [code, hostToken]);

  useEffect(() => {
    if (state?.status === 'done' && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [state?.status]);

  async function action(endpoint: string) {
    setActing(true);
    try {
      await fetch(`/api/game/${code}/${endpoint}`, {
        method: 'POST',
        headers: hostToken ? { 'x-host-token': hostToken } : {},
      });
    } finally {
      setActing(false);
    }
  }

  async function handleStart() {
    setActing(true);
    try {
      await fetch(`/api/game/${code}/start`, {
        method: 'POST',
        headers: hostToken ? { 'x-host-token': hostToken } : {},
      });
      if (!skipTutorial) setShowTutorial(true);
    } finally {
      setActing(false);
    }
  }

  async function handleEndGame() {
    setShowEndConfirm(false);
    setActing(true);
    try {
      await fetch(`/api/game/${code}/end`, {
        method: 'POST',
        headers: hostToken ? { 'x-host-token': hostToken } : {},
      });
      router.push('/');
    } finally {
      setActing(false);
    }
  }

  if (error) return (
    <main className="page">
      <div className="alert alert-error">{error}</div>
      <button className="btn mt-3" onClick={() => router.push('/')}>Go Home</button>
    </main>
  );
  if (!state) return <main className="page"><p className="text-muted waiting-shimmer">Connecting…</p></main>;

  const participants = Object.keys(state.participants);
  const allLayers: Matchup[][] = [...state.bracketHistory, ...(state.matchups.length > 0 ? [state.matchups] : [])];

  return (
    <>
      <main className="page">
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.5rem' }}>
            {state.status === 'done' ? 'Game Over' : `Round ${state.round} of ${state.totalRounds}`}
          </h2>
          {state.status !== 'done' && (
            <button
              className="btn"
              style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem', color: 'var(--muted)', marginTop: '0.2rem' }}
              onClick={() => setShowEndConfirm(true)}
            >
              End Game
            </button>
          )}
        </div>

        {/* Info bar — always visible */}
        <div className="host-info-bar">
          <div className="host-code-box">
            <div className="room-code host-room-code">
              <p className="host-bar-label">Room Code</p>
              {code}
            </div>
          </div>
          <div className="host-qr-box">
            {joinUrl && <QRCode value={joinUrl} size={114} bgColor="#f0f0f0" fgColor="#0f0f13" />}
          </div>
          <div className="host-players-box">
            <p className="host-bar-label">{participants.length} player{participants.length !== 1 ? 's' : ''} joined</p>
            <div className="chip-list">
              {participants.map(p => <span key={p} className="chip">{p}</span>)}
              {participants.length === 0 && (
                <span className="text-xs waiting-shimmer" style={{ display: 'inline-block' }}>
                  No one's here yet — share the code!
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Lobby */}
        {state.status === 'lobby' && (
          <>
            <hr />
            <p className="waiting-shimmer text-sm mb-2">
              Waiting for players to join — press Start when everyone's in!
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.5rem 0 0.75rem' }}>
              <input
                type="checkbox"
                id="skip-tutorial"
                checked={skipTutorial}
                onChange={e => setSkipTutorial(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
              <label htmlFor="skip-tutorial" style={{ fontSize: '0.85rem', color: 'var(--muted)', cursor: 'pointer', margin: 0 }}>
                Skip tutorial
              </label>
            </div>
            <button
              className={`btn btn-primary${acting ? ' waiting-shimmer' : ''}`}
              onClick={handleStart}
              disabled={acting || participants.length === 0}
            >
              {acting ? 'Starting…' : '▶ Start Game'}
            </button>
            {participants.length === 0 && (
              <p className="text-xs text-muted mt-1">You need at least one player to begin.</p>
            )}
          </>
        )}

        {/* Voting phase */}
        {state.status === 'voting' && (
          <>
            {allLayers.length > 0 && <BracketDiagram rounds={allLayers} currentRound={state.round} />}
            <hr />
            <h3 style={{ marginBottom: '1rem', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: '1rem' }}>
              Live Vote Counts
            </h3>
            {state.matchups.map((m, i) => {
              if (m.a === null || m.b === null) {
                const adv = m.a ?? m.b!;
                return (
                  <p key={i} className="text-sm text-muted" style={{ marginBottom: '0.5rem' }}>
                    Match {i + 1}: BYE — {truncate(adv.text, 60)} advances automatically
                  </p>
                );
              }
              const [va, vb] = getVoteCounts(m);
              const now = Date.now();
              const total = participants.filter(p => now - state.participants[p] < PLAYER_TIMEOUT_MS).length;
              return (
                <div key={i} style={{ marginBottom: '1.5rem' }}>
                  <p className="match-header">Match {i + 1} — {va + vb}/{total} voted</p>
                  <div className="grid-3">
                    <QuoteCard quote={m.a} />
                    <div className="vs-label" style={{ paddingTop: '2rem' }}>vs</div>
                    <QuoteCard quote={m.b} />
                  </div>
                  <VoteBar va={va} vb={vb} />
                </div>
              );
            })}
            {allVoted(state) ? (
              <div>
                <div className="alert alert-success"><span className="waiting-shimmer">Everyone's voted — ready to move on!</span></div>
                <button className={`btn btn-primary mt-2${acting ? ' waiting-shimmer' : ''}`} onClick={() => action('advance')} disabled={acting}>
                  {acting ? 'Resolving…' : 'Show Results'}
                </button>
              </div>
            ) : (
              <div className="alert alert-info">
                <span className="waiting-shimmer">Hang tight — waiting on a few more votes…</span>
              </div>
            )}
          </>
        )}

        {/* Results phase */}
        {state.status === 'results' && (
          <>
            {allLayers.length > 0 && <BracketDiagram rounds={allLayers} currentRound={state.round - 1} />}
            <hr />
            <h3 style={{ marginBottom: '1rem', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: '1rem' }}>
              Round Results
            </h3>
            {state.bracketHistory.length > 0 && (
              <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
                {state.bracketHistory[state.bracketHistory.length - 1].map((m, i) => {
                  if (!m.a || !m.b) return null;
                  const ws = m.winner ?? 'a';
                  const winner = m[ws]!;
                  const loser  = ws === 'a' ? m.b : m.a;
                  const [va, vb] = getVoteCounts(m);
                  const [wv, lv] = ws === 'a' ? [va, vb] : [vb, va];
                  return (
                    <div key={i} className="result-row">
                      <div className="result-loser">"{truncate(loser.text, 55)}"</div>
                      <div className="result-arrow">→</div>
                      <div className="result-winner">
                        "{truncate(winner.text, 55)}"
                        <span className="result-score"> — {wv}–{lv}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-sm text-muted mb-2">
              Up next: Round {state.round} — {state.matchups.length} matchup{state.matchups.length !== 1 ? 's' : ''}
            </p>
            <button className={`btn btn-primary${acting ? ' waiting-shimmer' : ''}`} onClick={() => action('start')} disabled={acting}>
              {acting ? 'Starting…' : `▶ Start Round ${state.round}`}
            </button>
          </>
        )}

        {/* Done */}
        {state.status === 'done' && state.champion && (
          <>
            <Confetti />
            <div className="champion-card">
              <div className="champion-label">🏆 Champion</div>
              <div className="champion-quote">"{state.champion.text}"</div>
              {state.champion.author && (
                <div className="champion-author">— {state.champion.author}</div>
              )}
            </div>
            {allLayers.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-muted mb-1" style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}>Full bracket</p>
                <BracketDiagram rounds={allLayers} currentRound={state.totalRounds} />
              </div>
            )}
            <button className="btn mt-3" onClick={() => router.push('/')}>↺ New Game</button>
            <BuyMeACoffee />
          </>
        )}
      </main>

      {/* ── How to Play tutorial overlay ── */}
      {showTutorial && (
        <div className="overlay">
          <div className="card overlay-card">
            <h2 style={{ fontSize: '1.4rem', marginBottom: '1.25rem' }}>[UN]Quotable — How to Play</h2>
            <p style={{ marginBottom: '1rem', lineHeight: 1.7 }}>
              Welcome to [UN]Quotable — The Game, a party game for friends with big mouths!
              Your host has assembled a list of quotes, and you will vote for which is the best of all.
            </p>
            <p style={{ marginBottom: '1.5rem', lineHeight: 1.7 }}>
              In each round of the bracket, select your favorite from each of the matches provided.
              When you are done, submit your votes! The most popular of each match moves on to the
              next round untill we declare a winner.
            </p>
            <hr style={{ marginBottom: '1rem' }} />
            <p className="text-xs text-muted" style={{ lineHeight: 1.6, marginBottom: '1.5rem' }}>
              <strong style={{ color: 'var(--muted)' }}>Privacy Notice:</strong> The only personal
              data collected is the display name you provide when joining. This data, along with all
              quote content and voting history, is permanently deleted when the game ends or
              automatically within 24 hours. No data is shared with third parties or retained beyond
              your session.
            </p>
            <button className="btn btn-primary btn-full" onClick={() => setShowTutorial(false)}>
              Got it, let's play!
            </button>
          </div>
        </div>
      )}

      {/* ── End Game confirmation overlay ── */}
      {showEndConfirm && (
        <div className="overlay">
          <div className="card overlay-card">
            <h3 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: '1.1rem', marginBottom: '0.75rem' }}>
              End this game?
            </h3>
            <p className="text-sm" style={{ lineHeight: 1.65, marginBottom: '1.5rem', color: 'var(--muted)' }}>
              This will immediately terminate the game and permanently delete all saved data,
              including the quotebook, player list, and vote history.
              Players will see their current screen until they refresh.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowEndConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleEndGame}>Yes, End Game</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
