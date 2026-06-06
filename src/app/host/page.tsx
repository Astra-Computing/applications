'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Quote } from '@/lib/types';
import { parseQuotebook, truncate } from '@/lib/gameLogic';

export default function HostSetupPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
        setError('Need at least 2 quotes. Check file format: "Quote text" - Author Name');
        setQuotes([]);
      } else {
        setQuotes(parsed);
      }
    };
    reader.readAsText(file);
  }

  async function handleCreate() {
    if (quotes.length < 2) return;
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
          <p className="text-xs text-muted mt-1">Format: <code style={{ color: 'var(--accent)' }}>"Quote text" - Author Name</code></p>
        </div>
      </div>

      {error && <div className="alert alert-error mt-2">{error}</div>}

      {quotes.length >= 2 && (
        <div className="mt-3">
          <p className="text-sm" style={{ marginBottom: '0.75rem' }}>
            <strong style={{ color: 'var(--accent)' }}>{quotes.length}</strong> quotes parsed
            {quotes.length % 2 === 1 && <span className="text-muted"> (1 BYE will be added)</span>}
          </p>

          <details>
            <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: '0.88rem', marginBottom: '0.5rem' }}>
              Preview first 10 quotes
            </summary>
            <div className="card mt-1" style={{ padding: '1rem' }}>
              {quotes.slice(0, 10).map((q, i) => (
                <p key={i} className="text-sm" style={{ padding: '0.25rem 0', borderBottom: '1px solid var(--border)' }}>
                  <em>"{truncate(q.text, 80)}"</em>
                  <span className="text-muted"> — {q.author}</span>
                </p>
              ))}
              {quotes.length > 10 && (
                <p className="text-xs text-muted mt-1">…and {quotes.length - 10} more</p>
              )}
            </div>
          </details>

          <button
            className={`btn btn-primary btn-full mt-3${loading ? ' waiting-shimmer' : ''}`}
            onClick={handleCreate}
            disabled={loading}
          >
            {loading ? 'Creating…' : 'Create Game'}
          </button>
        </div>
      )}
    </main>
  );
}
