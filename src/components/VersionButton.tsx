'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const HISTORY = [
  { v: '0.4.2', note: 'Results slideshow now has a rippling waterline and paces itself — brisk through big rounds, full length for the final. Phone players get a bigger header and footer, Join up front, a cursor waiting in the name box after a scan, a board that no longer jumps, and five minutes before a timeout. The win screen now ranks authors and players. Quotes written as an exchange, or signed with a bare name, are read correctly instead of keeping the name in the quote.' },
  { v: '0.4.1', note: 'Added host results slideshow; Start Next Round moved to the top of the host screen' },
  { v: '0.4.0', note: 'Champion screen now shows; reconnects recover; many reliability and accessibility fixes' },
  { v: '0.3.0', note: 'Voting now shows one matchup at a time; smaller coffee card' },
  { v: '0.2.7', note: 'Animated wave banners; fixed home title on mobile' },
  { v: '0.2.6', note: 'Fixed bracket BYE alignment for chained byes' },
  { v: '0.2.5', note: 'Improved reliability for gained/lost players' },
  { v: '0.2.4', note: 'Bug fixes' },
  { v: '0.2.3', note: 'Fixed preview quoting; enhanced parser' },
  { v: '0.2.2', note: 'Added tips to quotebook parser' },
  { v: '0.2.1', note: 'Pre-alpha launch' },
];

export default function VersionButton({ version }: { version: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button className="version-btn" onClick={() => setOpen(true)}>
        v{version}
      </button>
      {open && createPortal(
        <div className="overlay" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="card overlay-card version-modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: '1rem', marginBottom: '1rem' }}>
              Version History
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {HISTORY.map(({ v, note }) => (
                <div key={v} style={{ paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                  <span className="text-sm" style={{ color: 'var(--accent)', fontWeight: 600 }}>v{v}</span>
                  <span className="text-sm text-muted"> — {note}</span>
                </div>
              ))}
            </div>
            <button className="btn btn-full mt-3" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
