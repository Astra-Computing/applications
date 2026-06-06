import type { Metadata, Viewport } from 'next';
import './globals.css';
import TopBanner from '@/components/TopBanner';
import VersionButton from '@/components/VersionButton';

export const metadata: Metadata = {
  title: '[UN]Quotable — The Game',
  description: 'The ultimate quotebook bracket showdown',
  icons: { icon: '/UQTG005.png' },
};

// Tells mobile browsers to render at device width instead of faking a 980 px desktop
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

const VERSION = '0.2.2';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="root-body">
        <TopBanner />
        <div className="root-content">{children}</div>
        <div className="banner-bottom-wrap">
          <img src="/UQTG003.png" alt="" />
          <div className="banner-bottom-info">
            <span>Copyright Astra Computing 2026</span>
            <VersionButton version={VERSION} />
          </div>
        </div>
      </body>
    </html>
  );
}
