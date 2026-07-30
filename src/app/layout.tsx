import type { Metadata, Viewport } from 'next';
import './globals.css';
import TopBanner from '@/components/TopBanner';
import VersionButton from '@/components/VersionButton';
import WaveBanner from '@/components/WaveBanner';

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

const VERSION = '0.2.7';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="root-body">
        <TopBanner />
        <div className="root-content">{children}</div>
        <WaveBanner variant="slim" flip>
          <div className="banner-bottom-info">
            <span>Copyright Astra Computing 2026</span>
            <VersionButton version={VERSION} />
          </div>
        </WaveBanner>
      </body>
    </html>
  );
}
