'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Quote } from '@/lib/types';
import { parseQuotebook, truncate } from '@/lib/gameLogic';
import { useAnimatedNumber } from '@/lib/useAnimatedNumber';

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
  // Parsed total, held separately from `quotes` on purpose: a sub-minimum parse
  // clears `quotes`, so a count derived from it would report 0 for a one-quote
  // book. The host needs to see that their line WAS read, just not enough of it.
  const [parsedCount, setParsedCount] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  // R8/R10 fire on a change in the parsed count, not on every keystroke (KTD11).
  const [pulse, setPulse] = useState(false);
  const lastCountRef = useRef<number | null>(null);

  const hasQuotes = quotes.length >= 2;
  const shownCount = useAnimatedNumber(parsedCount ?? 0);
  // R11: one shimmer sweep at the moment the action unlocks, not while it stays
  // unlocked. Tracked rather than derived, because `hasQuotes` stays true after.
  const wasUnlocked = useRef(false);
  const [justUnlocked, setJustUnlocked] = useState(false);
  useEffect(() => {
    if (hasQuotes && !wasUnlocked.current) setJustUnlocked(true);
    wasUnlocked.current = hasQuotes;
  }, [hasQuotes]);

  // The single entry point for every input route - typing, pasting, dropping a
  // file, and picking one. Keeping one function here is what makes the three
  // routes provably identical rather than three parsers that drift.
  function ingest(raw: string) {
    const parsed = parseQuotebook(raw);
    // Compared against a ref rather than inside a setState updater: an updater
    // must stay pure, and React may invoke it twice in development.
    if (lastCountRef.current !== parsed.length) {
      lastCountRef.current = parsed.length;
      setPulse(true);
    }
    setParsedCount(parsed.length);
    if (parsed.length < 2) {
      setError(parsed.length === 0
        ? ''
        : 'Need at least 2 quotes. Check the Tips below for supported formats.');
      setQuotes([]);
      return;
    }
    setError('');
    setQuotes(parsed);
    setTipsOpen(false);
    setPreviewOpen(true);
  }

  function readFile(file: File) {
    setFileName(file.name);
    setError('');
    const reader = new FileReader();
    // Without an error handler a failed read left the filename showing - which
    // reads as success - with no quotes, no Create button and no explanation.
    reader.onerror = () => {
      setError('Could not read that file. Try selecting it again.');
      setFileName('');
      setQuotes([]);
      setParsedCount(null);
      lastCountRef.current = null;
    };
    reader.onload = ev => {
      const contents = ev.target?.result as string;
      setText(contents);
      ingest(contents);
    };
    reader.readAsText(file);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    readFile(file);
    // Clear the input so re-picking the same file fires onChange again, which
    // matters precisely when the first attempt failed.
    e.target.value = '';
  }

  function handleText(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setText(value);
    setFileName('');
    ingest(value);
  }

  // Drag state is counted at the window, not tracked on the box: dragenter and
  // dragleave fire for every descendant, so a naive handler flickers the
  // highlight off every time the pointer crosses a child element.
  useEffect(() => {
    let depth = 0;

    function onEnter(e: DragEvent) {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth += 1;
      setDragging(true);
    }
    function onLeave(e: DragEvent) {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    }
    // Both of these must preventDefault or the browser navigates away to the
    // dropped file, discarding everything the host has parsed so far.
    function onOver(e: DragEvent) {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
    }
    function onDrop(e: DragEvent) {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) readFile(file);
    }

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

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
      localStorage.setItem(`uq_host_${roomCode}`, hostToken);
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
        <label htmlFor="quotebook-text">Add your quotebook</label>
        {/* A plain container, not a <label for>. Wrapping both controls in one
            label forwards every click on its padding to the file input, so a
            host clicking the box to type would get an OS file dialog instead of
            a cursor - and the textarea would inherit no accessible name, since
            the label's belongs to the input it targets. */}
        <div
          className={`file-upload mt-1${dragging ? ' is-dragging' : ''}${pulse ? ' m-border-pulse' : ''}`}
          onAnimationEnd={() => setPulse(false)}
        >
          <textarea
            id="quotebook-text"
            className="qb-textarea"
            value={text}
            onChange={handleText}
            placeholder="Paste or type your quotes here — one per line"
            aria-label="Paste or type your quotebook, one quote per line"
            spellCheck={false}
            rows={6}
          />
          <div className="qb-upload-row">
            {/* A real <label for> on a focusable (not display:none) input: the
                previous click-only <div> left the file picker unreachable by
                keyboard, so a keyboard-only host could not create a game. */}
            <label className="qb-file-label" htmlFor="quotebook">
              <input id="quotebook" ref={fileRef} type="file" accept=".txt" onChange={handleFile} />
              {fileName ? `📄 ${fileName}` : 'or drop a .txt file — or choose one'}
            </label>
            {parsedCount !== null && (
              <span className="qb-count" aria-live="polite">
                {shownCount} {parsedCount === 1 ? 'quote' : 'quotes'} found
              </span>
            )}
          </div>
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

      {/* Preview dropdown — inactive until quotes are parsed */}
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
            'Preview — add some quotes first'
          )}
        </summary>
        {hasQuotes && (
          <div className="card qb-details-body">
            {quotes.slice(0, 10).map((q, i) => (
              // Keyed on content, not index: with key={i} React reuses the same
              // nodes across a second parse, so the entrance never replays.
              <p key={`${q.author}|${q.text}`} className="text-sm qb-preview-row m-rise" style={{ ['--stagger-index' as string]: i, ['--stagger-step' as string]: '30ms' }}>
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

      {/* Always rendered so "disabled" is a real state R5 can describe and a
          test can assert on. It used to be mounted only when hasQuotes. */}
      <button
        className={`btn btn-primary btn-full mt-3${loading ? ' waiting-shimmer' : ''}${justUnlocked ? ' waiting-shimmer shimmer-once' : ''}`}
        onClick={handleCreate}
        onAnimationEnd={() => setJustUnlocked(false)}
        disabled={!hasQuotes || loading}
      >
        {loading ? 'Creating…' : 'Create Game'}
      </button>
    </main>
  );
}
