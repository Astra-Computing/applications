'use client';
import { usePathname } from 'next/navigation';

export default function TopBanner() {
  const pathname = usePathname();
  if (pathname === '/') return null;
  return (
    <div className="banner-top">
      <img src="/UQTG002.png" alt="[UN]Quotable — The Game" />
    </div>
  );
}
