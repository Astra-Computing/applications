import Link from 'next/link';
import HomeBanner from '@/components/HomeBanner';
import BuyMeACoffee from '@/components/BuyMeACoffee';

export default function LandingPage() {
  return (
    <>
      <HomeBanner />
      <main className="page">
      <div className="text-center" style={{ paddingTop: '2.5rem', paddingBottom: '2rem' }}>
        <div className="grid-2" style={{ maxWidth: '540px', margin: '0 auto' }}>
          <div className="card flex-col">
            <h3 style={{ fontSize: '1.1rem', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>
              Host a Game
            </h3>
            <p className="text-muted text-sm">Import your quotebook and run the bracket.</p>
            <Link href="/host" className="btn btn-primary btn-full mt-2">
              Host
            </Link>
          </div>

          <div className="card flex-col">
            <h3 style={{ fontSize: '1.1rem', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>
              Join a Game
            </h3>
            <p className="text-muted text-sm">Enter the room code from your host.</p>
            <Link href="/join" className="btn btn-full mt-2">
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
