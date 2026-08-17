'use client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import WaveBanner from './WaveBanner';

export default function TopBanner() {
  const pathname = usePathname();
  if (pathname === '/') return null;
  return (
    <WaveBanner variant="slim">
      <Link href="/" className="banner-top-brand">
        <img src="/UQTG004.png" alt="[UN]" className="banner-top-brand-img" />
        <span className="banner-top-brand-text">Quotable — The Game</span>
      </Link>
    </WaveBanner>
  );
}
