'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { GameState, Matchup } from '@/lib/types';
import { allVoted, getVoteCounts, truncate, activePlayers, eligibleVoters } from '@/lib/gameLogic';
import QuoteCard from '@/components/QuoteCard';
import VoteBar from '@/components/VoteBar';
import BuyMeACoffee from '@/components/BuyMeACoffee';
import ResultsSlideshow from '@/components/ResultsSlideshow';
import WinRankings from '@/components/WinRankings';
import { useAnimatedNumber } from '@/lib/useAnimatedNumber';

const QRCode        = dynamic(() => import('react-qr-code'), { ssr: false });
const BracketDiagram = dynamic(() => import('@/components/BracketDiagram'), { ssr: false });
const Confetti      = dynamic(() => import('@/components/Confetti'), { ssr: false });

export default function HostPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [state, setState]           = useState<GameState | null>(null);
  // `error` is fatal and replaces the page; `stale` is a recoverable
  // connectivity blip shown as a banner over the last-known board.
  const [error, setError]           = useState('');
  const [stale, setStale]           = useState(false);
  const [actionError, setActionError] = useState('');
  const [tokenChecked, setTokenChecked] = useState(false);
  const [acting, setActing]         = useState(false);
  const [joinUrl, setJoinUrl]       = useState('');
  const [hostToken, setHostToken]   = useState('');
  const [skipTutorial, setSkipTutorial] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showQr, setShowQr] = useState(false);
  // R11/R12: auto-advance, restored per room from localStorage.
  const [autoAdvance, setAutoAdvance] = useState(false);
  // Records the phase+round already auto-fired. This CANNOT be the `acting`
  // state flag: the effect closes over a stale value and would read false
  // during an in-flight request, firing the same action twice.
  const autoFiredRef = useRef('');
  // Kick state is deliberately separate from `acting` / `actionError`: the
  // round-header button reads those for its label and disabled state, so
  // routing a kick through them would flip it to "Resolving..." while no round
  // is resolving.
  const [kickTarget, setKickTarget] = useState<string | null>(null);
  const [kicking, setKicking] = useState(false);
  const [kickError, setKickError] = useState('');
  // The round the host is currently being shown a recap of, captured from the
  // /advance response. Host-only and client-only: players never see it, and a
  // reload during `results` lands straight on the bracket.
  const [slideshowRound, setSlideshowRound] = useState<Matchup[] | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failCountRef = useRef(0);

  useEffect(() => {
    setAutoAdvance(localStorage.getItem(`uq_auto_${code}`) === '1');
  }, [code]);

  useEffect(() => {
    setJoinUrl(`${window.location.origin}/join?code=${code}`);
    // localStorage, not sessionStorage: sessionStorage is per-tab, so opening
    // the host URL in a second tab (or restoring one after a crash) left the
    // page shimmering "Connecting..." forever with no token, no error and no
    // way out - while the players waited on a host who could not act.
    setHostToken(localStorage.getItem(`uq_host_${code}`)
              ?? sessionStorage.getItem(`uq_host_${code}`)
              ?? '');
    setTokenChecked(true);
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
          // Recovered - clear the banner. Without this, `stale` latched on and
          // a brief blip stranded the host permanently, killing the game for
          // everyone, even though polling had already resumed underneath.
          setStale(false);
          setState(await res.json());
        } else if (res.status === 404) {
          setError('Room not found.');
        } else if (res.status === 401) {
          setError('This browser is not the host of this game.');
        } else if (++failCountRef.current >= 3) {
          setStale(true);
        }
      } catch {
        if (!cancelled && ++failCountRef.current >= 3) setStale(true);
      } finally {
        inFlight = false;
      }
    }

    poll();
    pollRef.current = setInterval(poll, 2000);

    // Mobile and background tabs suspend timers. Re-sync on return so a host
    // who looked away does not sit on a stale board - and so auto-advance
    // resumes on the next tick rather than waiting out a suspended interval.
    function onVisible() { if (document.visibilityState === 'visible') poll(); }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [code, hostToken]);

  useEffect(() => {
    if (state?.status === 'done' && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [state?.status]);

  // Escape closes whichever overlay is open. These are the host's only route
  // back to the controls, so without a keyboard dismissal a viewport that
  // clipped the button left them stuck.
  useEffect(() => {
    if (!showTutorial && !showEndConfirm && !showQr && !kickTarget) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setShowTutorial(false);
      setShowEndConfirm(false);
      setShowQr(false);
      setKickTarget(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showTutorial, showEndConfirm, showQr, kickTarget]);

  // The poll replaces `state` with a fresh object every 2s, so anything derived
  // from it is referentially new each tick and BracketDiagram re-diffs its whole
  // SVG (500+ nodes on a large bracket) even when the bracket hasn't moved.
  // Key the memo on the bracket's content only - participant heartbeats churn
  // constantly and must not count as a change.
  const bracketKey = state ? JSON.stringify([state.bracketHistory, state.matchups]) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allLayers: Matchup[][] = useMemo(
    () => (state ? [...state.bracketHistory, ...(state.matchups.length > 0 ? [state.matchups] : [])] : []),
    [bracketKey],
  );

  // Every mutating call used to ignore its response, so a rejected action
  // looked identical to a successful one: the button simply un-shimmered.
  async function post(endpoint: string): Promise<Response | null> {
    try {
      return await fetch(`/api/game/${code}/${endpoint}`, {
        method: 'POST',
        headers: hostToken ? { 'x-host-token': hostToken } : {},
      });
    } catch {
      return null;
    }
  }

  function describeFailure(res: Response | null): string {
    if (!res)                return 'Could not reach the server. Try again.';
    if (res.status === 401)  return 'This browser is no longer the host of this game.';
    if (res.status === 409)  return 'That action is not available right now.';
    if (res.status === 404)  return 'Room not found.';
    return 'Something went wrong. Try again.';
  }

  async function action(endpoint: string) {
    setActing(true);
    try {
      const res = await post(endpoint);
      if (!res || !res.ok) { setActionError(describeFailure(res)); return; }
      setActionError('');
      // /advance returns the resulting state, so the champion appears at once
      // rather than after the next poll tick.
      const body = await res.json().catch(() => null);
      if (body?.state) {
        setState(body.state);
        if (endpoint === 'advance') {
          const history: Matchup[][] = body.state.bracketHistory ?? [];
          const resolved = history[history.length - 1];
          if (resolved?.length) setSlideshowRound(resolved);
        }
      }
    } finally {
      setActing(false);
    }
  }

  async function handleStart() {
    setActing(true);
    try {
      const res = await post('start');
      if (!res || !res.ok) { setActionError(describeFailure(res)); return; }
      setActionError('');
      // Only after the server confirms: this used to open regardless, so on a
      // rejected start the host dismissed a tutorial for a game that had not
      // begun and waited indefinitely alongside the players.
      if (!skipTutorial) setShowTutorial(true);
    } finally {
      setActing(false);
    }
  }

  async function handleKick(name: string) {
    setKicking(true);
    try {
      const res = await fetch(`/api/game/${code}/kick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(hostToken ? { 'x-host-token': hostToken } : {}) },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) { setKickError(describeFailure(res)); return; }
      setKickError('');
      setKickTarget(null);
      // The next poll (within 2s) drops them from the roster; no local edit.
    } catch {
      setKickError('Could not remove that player. Try again.');
    } finally {
      setKicking(false);
    }
  }

  async function handleEndGame() {
    setShowEndConfirm(false);
    setActing(true);
    try {
      const res = await post('end');
      if (!res || !res.ok) { setActionError(describeFailure(res)); return; }
      router.replace('/');
    } finally {
      setActing(false);
    }
  }

  // ── Auto-advance (R11, R11a, R12) ──
  // Above the early returns with the motion hooks, for the same reason: hook
  // order must not depend on whether `state` has arrived yet.
  //
  // Fires exactly the action the visible button fires, so the button keeps its
  // meaning and stays usable throughout. The ref guard - not `acting` - is what
  // makes a second poll tick during an in-flight request a no-op.
  useEffect(() => {
    if (!autoAdvance || !state || acting) return;
    const key = `${state.status}:${state.round}`;
    if (autoFiredRef.current === key) return;

    if (state.status === 'voting') {
      // R11a: an abandoned room runs on to the champion rather than freezing.
      // This is auto-advance's own condition - `allVoted` deliberately stays
      // false for an empty room so the manual button's meaning is unchanged.
      const abandoned = eligibleVoters(state).length === 0;
      if (allVoted(state) || abandoned) {
        autoFiredRef.current = key;
        action('advance');
      }
    } else if (state.status === 'results' && slideshowRound === null) {
      // Waiting on the recap is what keeps an abandoned room resolving at
      // recap pace rather than at poll pace.
      autoFiredRef.current = key;
      action('start');
    }
    // `action` is a stable function declaration in this component's scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdvance, state, acting, slideshowRound]);

  // ── Motion hooks ──
  // These sit above the early returns below on purpose. Hooks must run in the
  // same order on every render, and `state` is null on the first pass - putting
  // them after `if (!state) return` throws "Rendered more hooks than during the
  // previous render" the moment the first poll lands. Every input is therefore
  // computed defensively rather than from the post-guard locals.
  const participantCount = state ? Object.keys(state.participants).length : 0;
  // R15 / R23: counts animate between values.
  const shownPlayers = useAnimatedNumber(participantCount);
  const shownNext = useAnimatedNumber(state?.matchups.length ?? 0);
  // R19: bump the forward action once, at the moment the room becomes ready.
  const ready = state ? allVoted(state) : false;
  const wasReady = useRef(false);
  const [readyBump, setReadyBump] = useState(false);
  useEffect(() => {
    if (ready && !wasReady.current) setReadyBump(true);
    wasReady.current = ready;
  }, [ready]);

  if (error) return (
    <main className="page">
      <div className="alert alert-error">{error}</div>
      <button className="btn mt-3" onClick={() => router.replace('/')}>Go Home</button>
    </main>
  );
  if (tokenChecked && !hostToken) return (
    <main className="page">
      <div className="alert alert-error">
        This tab isn&apos;t the one that created the game, so it can&apos;t control it.
        Reopen the game from the tab or device you started it on.
      </div>
      <button className="btn mt-3" onClick={() => router.replace('/')}>Go Home</button>
    </main>
  );
  if (!state) return (
    <main className="page">
      {stale
        ? <>
            <div className="alert alert-error">Connection lost. Retrying…</div>
            <button className="btn mt-3" onClick={() => router.replace('/')}>Go Home</button>
          </>
        : <p className="text-muted waiting-shimmer">Connecting…</p>}
    </main>
  );

  // Active only (R14): the roster and the advance gate must never disagree,
  // so both read the same predicate.
  const participants = activePlayers(state);
  const slideshowActive = slideshowRound !== null;
  // U6/U7 (KTD9): the results screen renders UNDER the slideshow, which is
  // position:fixed inset:0 over an opaque background for up to ~9s. Motion
  // started on arrival at `results` would run to completion unseen, so it is
  // keyed off the slideshow finishing instead.
  const resultsRevealed = state?.status === 'results' && !slideshowActive;

  // The one control that moves the game forward, hoisted into the round header.
  // `ready` mirrors the server's own phase gate so the button never promises an
  // action the API would reject: /advance accepts only `voting`, /start only
  // `results` (the lobby has its own Start Game flow with the tutorial opt-out).
  const headerAction =
    state.status === 'voting'
      ? {
          label: acting ? 'Resolving…' : '▶ Show Results',
          onClick: () => action('advance'),
          ready: allVoted(state),
          status: 'Waiting for voting to finish…',
        }
      : state.status === 'results'
        ? {
            label: acting ? 'Starting…' : `▶ Start Round ${state.round}`,
            onClick: () => action('start'),
            // The round on screen has already been resolved; keep the host from
            // starting the next one out from under their own recap.
            ready: !slideshowActive,
            status: 'Showing this round’s results…',
          }
        : null;

  return (
    <>
      <main className="page">
        {stale && <div className="alert alert-error mb-2">Connection lost. Retrying…</div>}
        {actionError && <div className="alert alert-error mb-2">{actionError}</div>}
        {/* Header row — round designation, then the forward control */}
        <div className="round-header">
          <h2 className="round-header-title">
            {state.status === 'done' ? 'Game Over' : `Round ${state.round} of ${state.totalRounds}`}
          </h2>
          {headerAction && (
            <div className="round-header-action">
              <button
                className={`btn btn-primary${acting ? ' waiting-shimmer' : ''}${readyBump ? ' m-bump' : ''}`}
                onClick={headerAction.onClick}
                onAnimationEnd={() => setReadyBump(false)}
                disabled={acting || !headerAction.ready}
              >
                {headerAction.label}
              </button>
              {!headerAction.ready && !acting && !autoAdvance && (
                <p className="round-header-status waiting-shimmer">{headerAction.status}</p>
              )}
              <label className="auto-advance">
                <input
                  type="checkbox"
                  checked={autoAdvance}
                  onChange={e => {
                    const on = e.target.checked;
                    setAutoAdvance(on);
                    // Persist per room so a reload does not silently change how
                    // the game behaves (R12).
                    localStorage.setItem(`uq_auto_${code}`, on ? '1' : '0');
                    // Let the new setting act on the current phase immediately
                    // rather than waiting for the next one.
                    autoFiredRef.current = '';
                  }}
                />
                Advance automatically
              </label>
            </div>
          )}
          <div className="round-header-spacer" />
          {state.status !== 'done' && (
            <button className="btn round-header-end" onClick={() => setShowEndConfirm(true)}>
              End Game
            </button>
          )}
        </div>

        {/* Info bar — always visible */}
        <div className="host-info-bar">
          <div className="host-code-box">
            <div className={`room-code host-room-code${state.status === 'lobby' ? ' is-waiting' : ''}`}>
              <p className="host-bar-label">Room Code</p>
              {code}
            </div>
          </div>
          {/* A real <button>, not a click-handling div: this has to be
              reachable and operable by keyboard like every other control. */}
          <button
            type="button"
            className="host-qr-box host-qr-button"
            onClick={() => setShowQr(true)}
            aria-label="Enlarge the join QR code"
            disabled={!joinUrl}
          >
            {joinUrl && <QRCode value={joinUrl} size={114} bgColor="#f0f0f0" fgColor="#0f0f13" />}
            <span className="host-qr-hint">Tap to enlarge</span>
          </button>
          <div className="host-players-box">
            <p className="host-bar-label">{shownPlayers} player{participants.length !== 1 ? 's' : ''} joined</p>
            <div className="chip-list">
              {/* Keyed on the name, so an existing chip does not replay its
                  entrance on every 2s poll tick. */}
              {participants.map(p => (
                <button
                  key={p}
                  type="button"
                  className="chip chip-kick m-pop"
                  onClick={() => { setKickError(''); setKickTarget(p); }}
                  aria-label={`Remove ${p} from the game`}
                >
                  {p}
                </button>
              ))}
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
            {allLayers.length > 0 && <BracketDiagram rounds={allLayers} currentRound={state.round} revealed={!slideshowActive} />}
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
              const total = participants.length;
              return (
                <div
                  key={`r${state.round}-${i}`}
                  className="m-rise"
                  style={{ marginBottom: '1.5rem', ['--stagger-index' as string]: i }}
                >
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
              <div key="ready" className="alert alert-success m-crossfade">
                <span className="waiting-shimmer">Everyone's voted — ready to move on!</span>
              </div>
            ) : (
              <div key="waiting" className="alert alert-info m-crossfade">
                <span className="waiting-shimmer">Hang tight — waiting on a few more votes…</span>
              </div>
            )}
          </>
        )}

        {/* Results phase */}
        {state.status === 'results' && (
          <>
            {allLayers.length > 0 && <BracketDiagram rounds={allLayers} currentRound={state.round - 1} revealed={resultsRevealed} />}
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
                    <div
                      key={i}
                      className={`result-row${resultsRevealed ? ' m-resolve' : ''}`}
                      style={{ ['--stagger-index' as string]: i }}
                    >
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
              Up next: Round {state.round} — {shownNext} matchup{state.matchups.length !== 1 ? 's' : ''}
            </p>
          </>
        )}

        {/* Done */}
        {state.status === 'done' && state.champion && (
          <>
            {!slideshowActive && <Confetti />}
            <div className="champion-card win-card">
              <div className="champion-label">🏆 Champion</div>
              <div className="champion-quote win-quote">"{state.champion.text}"</div>
              {state.champion.author && (
                <div className="champion-author win-author">— {state.champion.author}</div>
              )}
            </div>
            {/* Host-only: the popularity table needs the raw voter names, which
                only the host's response carries. */}
            <WinRankings bracketHistory={state.bracketHistory} />
            {allLayers.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-muted mb-1" style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}>Full bracket</p>
                <BracketDiagram rounds={allLayers} currentRound={state.totalRounds} revealed={!slideshowActive} />
              </div>
            )}
            <button className="btn mt-3" onClick={() => router.push('/')}>↺ New Game</button>
            <BuyMeACoffee fullWidth />
          </>
        )}
      </main>

      {/* ── Round-results recap (host only, client only) ── */}
      {slideshowRound && (
        <ResultsSlideshow round={slideshowRound} onFinish={() => setSlideshowRound(null)} />
      )}

      {/* ── Remove-player confirmation (R7) ── */}
      {kickTarget && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="card overlay-card">
            <h3 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: '1rem', marginBottom: '0.75rem' }}>
              Remove {kickTarget}?
            </h3>
            <p className="text-sm text-muted">
              They will be told the host removed them, and can join again with the room code.
              Votes they have already cast stay counted.
            </p>
            {kickError && <div className="alert alert-error mt-2">{kickError}</div>}
            {/* Not .btn-danger: a kick is a nudge, not the irreversible
                deletion End Game warns about. */}
            <div className="flex-row mt-3">
              <button
                className={`btn btn-primary${kicking ? ' waiting-shimmer' : ''}`}
                onClick={() => handleKick(kickTarget)}
                disabled={kicking}
              >
                {kicking ? 'Removing…' : 'Remove'}
              </button>
              <button className="btn" onClick={() => setKickTarget(null)} disabled={kicking}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Enlarged QR overlay (R17) ── */}
      {showQr && joinUrl && (
        <div
          className="overlay qr-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Join QR code"
          onClick={() => setShowQr(false)}
        >
          {/* Stop the card's own clicks from reaching the click-away handler. */}
          <div className="card overlay-card qr-overlay-card" onClick={e => e.stopPropagation()}>
            <div className="qr-overlay-code">
              <QRCode
                value={joinUrl}
                size={512}
                bgColor="#f0f0f0"
                fgColor="#0f0f13"
                style={{ width: '100%', height: 'auto' }}
              />
            </div>
            <p className="room-code qr-overlay-room">{code}</p>
            <p className="text-sm text-muted text-center">{joinUrl}</p>
            <button className="btn btn-full mt-2" onClick={() => setShowQr(false)}>Close</button>
          </div>
        </div>
      )}

      {/* ── How to Play tutorial overlay ── */}
      {showTutorial && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="card overlay-card">
            <h2 style={{ fontSize: '1.4rem', marginBottom: '1.25rem' }}>[UN]Quotable — How to Play</h2>
            <p style={{ marginBottom: '1rem', lineHeight: 1.7 }}>
              Welcome to [UN]Quotable — The Game, a party game for friends with big mouths!
              Your host has assembled a list of quotes, and you will vote for which is the best of all.
            </p>
            <p style={{ marginBottom: '1.5rem', lineHeight: 1.7 }}>
              In each round of the bracket, select your favorite from each of the matches provided.
              When you are done, submit your votes! The most popular of each match moves on to the
              next round until we declare a winner.
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
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="card overlay-card">
            <h3 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: '1.1rem', marginBottom: '0.75rem' }}>
              End this game?
            </h3>
            <p className="text-sm" style={{ lineHeight: 1.65, marginBottom: '1.5rem', color: 'var(--muted)' }}>
              This will immediately terminate the game and permanently delete all saved data,
              including the quotebook, player list, and vote history.
              Players will be returned to a “Room not found” screen within a few seconds.
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
