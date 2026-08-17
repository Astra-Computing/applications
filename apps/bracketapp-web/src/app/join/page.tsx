'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function JoinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState(searchParams.get('code')?.toUpperCase() ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleJoin() {
    const trimCode = code.trim().toUpperCase();
    const trimName = name.trim();
    if (!trimCode || !trimName) { setError('Please fill in both fields.'); return; }
    setError('');
    setLoading(true);
    try {
      const raw = sessionStorage.getItem(`uq_session_${trimCode}`);
      const saved = raw ? JSON.parse(raw) as { name: string; token: string } : null;
      const existingToken = saved?.name === trimName ? saved.token : undefined;

      const res = await fetch(`/api/game/${trimCode}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimName, existingToken }),
      });
      if (res.status === 404) { setError('Room not found. Check the code and try again.'); setLoading(false); return; }
      if (res.status === 409) { setError('That name is already taken. Please choose a different one.'); setLoading(false); return; }
      if (!res.ok) { setError('Something went wrong.'); setLoading(false); return; }
      const { token } = await res.json();
      sessionStorage.setItem(`uq_session_${trimCode}`, JSON.stringify({ name: trimName, token }));
      router.push(`/room/${trimCode}/player`);
    } catch {
      setError('Could not connect to server.');
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/" className="btn" style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem' }}>← Back</Link>
        <h2 style={{ fontSize: '1.6rem' }}>Join a Game</h2>
      </div>
      <hr />

      <div className="flex-col mt-3" style={{ maxWidth: '400px' }}>
        <div>
          <label htmlFor="code">Room Code</label>
          <input
            id="code"
            className="input"
            type="text"
            maxLength={4}
            placeholder="ABCD"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            style={{ letterSpacing: '0.2em', fontWeight: 600 }}
          />
        </div>
        <div>
          <label htmlFor="name">Your Name</label>
          <input
            id="name"
            className="input"
            type="text"
            placeholder="Player"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
          />
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <button className={`btn btn-primary${loading ? ' waiting-shimmer' : ''}`} onClick={handleJoin} disabled={loading}>
          {loading ? 'Joining…' : 'Join →'}
        </button>
      </div>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinForm />
    </Suspense>
  );
}
