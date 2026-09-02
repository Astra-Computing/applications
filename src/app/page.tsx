import Link from 'next/link';
import HomeBanner from '@/components/HomeBanner';
import BuyMeACoffee from '@/components/BuyMeACoffee';

/* Line-art icons matching the coffee mug's treatment: drawn at the same visual
   size and weight, with the one enclosed shape carrying the same faint wash.
   Stroked in `--text` rather than the accent, so the mug stays the only blue
   icon on the page - it is the sole opt-in action and should not be one of a
   set of three. `--text` is the warm off-white the titles beneath use, not a
   hard-coded #fff, per the no-hex-in-components rule. Drawn on a 24-unit grid and
   scaled up, where the mug uses a 56x52 one - the grid is arbitrary, the
   rendered size is what has to agree. Inline <svg>, never a file or a data URI:
   the CSP blocks both. */

function IconPresentation() {
  return (
    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" aria-hidden="true"
         stroke="var(--text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Screen on a stand, with a rising line inside it */}
      <rect x="3" y="4" width="18" height="12" rx="1.5" fill="rgba(232,230,225,0.08)" />
      <path d="M12 16v4" />
      <path d="M9 20h6" />
      <path d="M7 12l3-3 2.5 2.5L17 8" />
    </svg>
  );
}

function IconPlayers() {
  return (
    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" aria-hidden="true"
         stroke="var(--text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Two smaller figures flanking a larger one, so the group reads as a room
          of players rather than one generic person icon. The shoulder arcs need
          a real gap between them (0.9 units) or they merge into a single
          squiggle, and the centre head has to be both larger and higher, or
          "bigger" doesn't register. */}
      <circle cx="3.8" cy="11.2" r="2.1" />
      <path d="M0.9 19.6a2.9 2.9 0 0 1 5.8 0" />
      <circle cx="20.2" cy="11.2" r="2.1" />
      <path d="M17.3 19.6a2.9 2.9 0 0 1 5.8 0" />
      <circle cx="12" cy="7.6" r="3.1" fill="rgba(232,230,225,0.08)" />
      <path d="M7.6 19.6a4.4 4.4 0 0 1 8.8 0" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <>
      <HomeBanner />
      <main className="page">
      <div className="text-center" style={{ paddingTop: '2.5rem', paddingBottom: '2rem' }}>
        <div className="grid-2" style={{ maxWidth: '540px', margin: '0 auto' }}>
          {/* Order and emphasis are swapped on phones - see .home-choice-join
              in globals.css. A phone is almost always a player; the host is on
              a laptop or a TV. */}
          <div className="card flex-col home-choice home-choice-host">
            <div className="home-choice-top">
              <IconPresentation />
              <h3 className="home-choice-title">Host a Game</h3>
            </div>
            <p className="text-muted text-sm">Import your quotebook and run the bracket.</p>
            <Link href="/host" className="btn btn-primary btn-full mt-2 home-cta-host">
              Host
            </Link>
          </div>

          <div className="card flex-col home-choice home-choice-join">
            <div className="home-choice-top">
              <IconPlayers />
              <h3 className="home-choice-title">Join a Game</h3>
            </div>
            <p className="text-muted text-sm">Enter the room code from your host.</p>
            <Link href="/join" className="btn btn-full mt-2 home-cta-join">
              Join
            </Link>
          </div>
        </div>
        <BuyMeACoffee />
      </div>
      </main>
    </>
  );
}
