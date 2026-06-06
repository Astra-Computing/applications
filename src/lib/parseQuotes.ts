import { Quote } from './types';

/**
 * Parse a quotebook text file into Quote objects.
 *
 * The only hard rule: one quote (or exchange) per line. Blank lines are skipped.
 *
 * Handled formats (in order of detection):
 *
 *  Multi-speaker (tab or 2+ space separated)
 *    Corbin: "text"[TAB]Jeron: "text"[TAB]Jon: "text"
 *    Ed: "text"   Jeron: "text"
 *    → text = each turn on its own line, author = "Corbin, Jeron, Jon"
 *
 *  Standard with attribution after closing quote
 *    "Quote text" - Author
 *    "Quote text" — Author        (em dash)
 *    "Quote text"-Author          (no space)
 *    (context) "Quote text" - Author
 *    "Quote - with - dashes" - Author   ← dashes inside text are safe
 *
 *  Unquoted with attribution
 *    Quote text — Author
 *    Quote text - Author
 *
 *  No attribution
 *    "Quote text"
 *    Quote text
 *    → author = "Unknown"
 */
export function parseQuotebook(rawText: string): Quote[] {
  return rawText
    .split('\n')
    .map(parseQuoteLine)
    .filter((q): q is Quote => q !== null);
}

// ── Speaker pattern: Name: "text" ──────────────────────────────────────────
// Matches both ASCII " and curly " / " quote marks.
const SPEAKER_RE = /(\w[\w\s.']*?)\s*:\s*[""]([^"""]*?)["""]/g;

function parseQuoteLine(raw: string): Quote | null {
  const line = raw.trim();
  if (!line) return null;

  // ── 1. Multi-speaker detection ──────────────────────────────────────────
  // Fires when 2+ Name: "text" segments are found AND turns are separated
  // by a tab or 2+ consecutive spaces (the visual marker used in personal QBs).
  if (/\t| {2,}/.test(line)) {
    SPEAKER_RE.lastIndex = 0;
    const speakers: string[] = [];
    const turns: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = SPEAKER_RE.exec(line)) !== null) {
      const name = m[1].trim();
      const text = m[2].trim();
      speakers.push(name);
      turns.push(`"${text}"`);
    }
    if (speakers.length >= 2) {
      return {
        text: turns.join('\n'),
        author: dedupe(speakers).join(', '),
        sortAuthor: speakers[speakers.length - 1], // last speaker drives bracket grouping
      };
    }
  }

  // ── 2. Attribution after the last closing-quote character ───────────────
  // This is the most reliable approach: find where the quoted text ends, then
  // check what follows. Dashes INSIDE the quote are completely ignored.
  const closeIdx = lastClosingQuoteIdx(line);
  if (closeIdx > 0) {
    const after = line.slice(closeIdx + 1);
    const attr = matchAttribution(after);
    if (attr !== undefined) {
      return {
        text: stripOuterQuotes(line.slice(0, closeIdx + 1)),
        author: attr || 'Unknown',
      };
    }
    // Something follows the close-quote that isn't an attribution — fall through.
  }

  // ── 3. Em / en dash anywhere in the line (unquoted lines) ───────────────
  const emIdx = lastIndexOfChars(line, '—–'); // — and –
  if (emIdx > 0) {
    const text = line.slice(0, emIdx).trimEnd();
    const author = line.slice(emIdx + 1).trim();
    if (text && author) return { text: stripOuterQuotes(text), author };
  }

  // ── 4. Spaced hyphen " - " ───────────────────────────────────────────────
  const hypIdx = line.lastIndexOf(' - ');
  if (hypIdx > 0) {
    const text = line.slice(0, hypIdx).trim();
    const author = line.slice(hypIdx + 3).trim();
    if (text && author) return { text: stripOuterQuotes(text), author };
  }

  // ── 5. No attribution found ──────────────────────────────────────────────
  return { text: stripOuterQuotes(line), author: 'Unknown' };
}

/**
 * Given the string that comes after the last closing quote, returns:
 *   string  — the attribution text (empty string means "no attribution")
 *   undefined — the content isn't an attribution pattern; caller should fall through
 */
function matchAttribution(after: string): string | undefined {
  const s = after.trimStart();
  if (!s) return '';           // Line ends cleanly at closing quote — no attribution

  // Em / en dash: "—Author" or "— Author"
  if (s[0] === '—' || s[0] === '–') {
    return s.slice(1).trim() || 'Unknown';
  }

  // Spaced hyphen: "- Author" (space required after dash)
  if (s.startsWith('- ') || s.startsWith('-\t')) {
    return s.slice(2).trim() || 'Unknown';
  }

  // Bare hyphen directly before a word: "-Author" (common in personal quotebooks)
  if (s[0] === '-' && s.length > 1 && /\w/.test(s[1])) {
    return s.slice(1).trim() || 'Unknown';
  }

  // Content present but not an attribution pattern (e.g. more quote text follows)
  return undefined;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function lastClosingQuoteIdx(s: string): number {
  // Closing quote characters: ASCII ", curly " (U+201D), right single ' (U+2019)
  const CLOSE = new Set(['"', '”', '’']);
  for (let i = s.length - 1; i >= 0; i--) {
    if (CLOSE.has(s[i])) return i;
  }
  return -1;
}

function lastIndexOfChars(s: string, chars: string): number {
  for (let i = s.length - 1; i >= 0; i--) {
    if (chars.includes(s[i])) return i;
  }
  return -1;
}

/**
 * Strip one layer of wrapping quote characters from both ends.
 * Only strips if the first char is an open-quote AND the last is a close-quote
 * (so inner dialogue quotes are never accidentally removed).
 */
function stripOuterQuotes(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length < 2) return trimmed;
  const OPEN = new Set(['"', '“', '„', '‘', '‚']);
  const CLOSE = new Set(['"', '”', '’']);
  if (OPEN.has(trimmed[0]) && CLOSE.has(trimmed[trimmed.length - 1])) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}
