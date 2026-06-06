'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Quote } from '@/lib/types';
import { parseQuotebook, truncate } from '@/lib/gameLogic';

function previewQuote(text: string, maxLen: number): string {
  if (text.includes('\n')) {
    return text.split('\n').map(l => truncate(l, maxLen)).join(' / ');
  }
  const t = truncate(text, maxLen);
  const hasQuotes = t.includes('"') || t.includes('“') || t.includes('”');
  return hasQuotes ? t : `"${t}"`;
}

export default function HostSetupPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);

  const hasQuotes = quotes.length >= 2;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError('');
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const parsed = parseQuotebook(text);
      if (parsed.length < 2) {
        setError('Need at least 2 quotes. Check the Tips below for supported formats.');
        setQuotes([]);
      } else {
        setQuotes(parsed);
        setTipsOpen(false);
        setPreviewOpen(true);
      }
    };
    reader.readAsText(file);
  }

  async function handleCreate() {
    if (!hasQuotes) return;
    setLoading(true);
    try {
      const res = await fetch('/api/game/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quotes }),
      });
      if (!res.ok) throw new Error('Server error');
      const { roomCode, hostToken } = await res.json();
      sessionStorage.setItem(`uq_host_${roomCode}`, hostToken);
      router.push(`/room/${roomCode}/host`);
    } catch {
      setError('Failed to create game. Is the server running?');
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/" className="btn" style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem' }}>← Back</Link>
        <h2 style={{ fontSize: '1.6rem' }}>Host Setup</h2>
      </div>

      <hr />

      <div className="mt-3">
        <label>Upload quotebook (.txt)</label>
        <div className="file-upload mt-1" onClick={() => fileRef.current?.click()}>
          <input ref={fileRef} type="file" accept=".txt" onChange={handleFile} />
          {fileName
            ? <p style={{ color: 'var(--text)' }}>{fileName}</p>
            : <p className="text-muted">Click to choose a .txt file</p>
          }
        </div>
      </div>

      {error && <div className="alert alert-error mt-2">{error}</div>}

      {/* Tips dropdown — expanded by default, compacts after upload */}
      <details
        className="qb-details mt-3"
        open={tipsOpen}
        onToggle={e => setTipsOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="qb-summary">Tips — formatting your quotebook</summary>
        <div className="card qb-details-body">
          <p className="qb-big-rule">One quote per line — blank lines are ignored.</p>
          <table className="qb-table">
            <thead>
              <tr><th>Format</th><th>Example</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Quoted + hyphen</td>
                <td><code>"Quote text" - Author</code></td>
              </tr>
              <tr>
                <td>Quoted + em dash</td>
                <td><code>"Quote text" — Author</code></td>
              </tr>
              <tr>
                <td>Quoted, no attribution</td>
                <td><code>"Quote text"</code></td>
              </tr>
              <tr>
                <td>Unquoted + attribution</td>
                <td><code>Quote text - Author</code></td>
              </tr>
              <tr>
                <td>Plain text</td>
                <td><code>Quote text</code> <span className="text-muted text-xs">(author shown as Unknown)</span></td>
              </tr>
              <tr>
                <td>Single speaker</td>
                <td><code>Name: "Quote text"</code></td>
              </tr>
              <tr>
                <td>Multi-speaker exchange</td>
                <td><code>Name: "text"[Tab]Name: "text"</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      {/* Preview dropdown — inactive until a file is uploaded */}
      <details
        className={`qb-details mt-2${!hasQuotes ? ' qb-details-inactive' : ''}`}
        open={previewOpen}
        onToggle={e => {
          if (!hasQuotes) { e.preventDefault(); return; }
          setPreviewOpen((e.target as HTMLDetailsElement).open);
        }}
      >
        <summary
          className="qb-summary"
          onClick={!hasQuotes ? e => e.preventDefault() : undefined}
        >
          {hasQuotes ? (
            <>
              Preview —{' '}
              <strong style={{ color: 'var(--accent)' }}>{quotes.length}</strong> quotes parsed
              {quotes.length % 2 === 1 && <span className="text-muted"> (1 BYE will be added)</span>}
            </>
          ) : (
            'Preview — upload a file first'
          )}
        </summary>
        {hasQuotes && (
          <div className="card qb-details-body">
            {quotes.slice(0, 10).map((q, i) => (
              <p key={i} className="text-sm" style={{ padding: '0.25rem 0', borderBottom: '1px solid var(--border)' }}>
                <em>{previewQuote(q.text, 80)}</em>
                <span className="text-muted"> — {q.author}</span>
              </p>
            ))}
            {quotes.length > 10 && (
              <p className="text-xs text-muted mt-1">…and {quotes.length - 10} more</p>
            )}
          </div>
        )}
      </details>

      {hasQuotes && (
        <button
          className={`btn btn-primary btn-full mt-3${loading ? ' waiting-shimmer' : ''}`}
          onClick={handleCreate}
          disabled={loading}
        >
          {loading ? 'Creating…' : 'Create Game'}
        </button>
      )}
    </main>
  );
}
