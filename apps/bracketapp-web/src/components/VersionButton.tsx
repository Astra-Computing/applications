'use client';
import { useState } from 'react';
import { createPortal } from 'react-dom';

const HISTORY = [
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
  return (
    <>
      <button className="version-btn" onClick={() => setOpen(true)}>
        v{version}
      </button>
      {open && createPortal(
        <div className="overlay" onClick={() => setOpen(false)}>
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
