import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseQuotebook } from '@/lib/parseQuotes';

/**
 * The stress corpus and its expected attributions.
 *
 * Deliberately read from `tests/fixtures/parser/`, NOT from `quotebooks/`:
 * that directory is gitignored (real quote content stays local), so a fixture
 * read from there exists on one machine and is absent in CI.
 *
 * The key is written as `"text" — Author`, one line per input line.
 */
const FIXTURES = path.resolve(__dirname, '../../tests/fixtures/parser');
const read = (f: string) =>
  readFileSync(path.join(FIXTURES, f), 'utf8').split('\n').filter(l => l.trim() !== '');

describe('parseQuotebook — stress corpus', () => {
  const input = readFileSync(path.join(FIXTURES, 'StressTest.txt'), 'utf8');
  const parsed = parseQuotebook(input);
  const key = read('StressTestKey.txt');

  it('parses one quote per non-blank line', () => {
    expect(parsed).toHaveLength(key.length);
  });

  it('attributes every line as the key expects', () => {
    // The key's author is everything after the final em dash.
    const expectedAuthors = key.map(line => line.slice(line.lastIndexOf('—') + 1).trim());
    expect(parsed.map(q => q.author)).toEqual(expectedAuthors);
  });

  it('never leaves a speaker name inside the quote text', () => {
    // This is the defect that surfaced in a truncated bracket cell: the name
    // was never rendered as an author, it was sitting in `quote.text`.
    for (const q of parsed) {
      if (q.author === 'Unknown') continue;
      for (const name of q.author.split(',').map(n => n.trim())) {
        expect(q.text.startsWith(name + ':')).toBe(false);
      }
    }
  });
});

describe('parseQuotebook — attribution forms', () => {
  it('reads a hyphen attribution after the closing quote', () => {
    expect(parseQuotebook('"Quote text" - Author')[0]).toMatchObject({
      text: 'Quote text', author: 'Author',
    });
  });

  it('keeps a dash that lives inside the quote', () => {
    const [q] = parseQuotebook('"Well - actually - no" - Author');
    expect(q.author).toBe('Author');
    expect(q.text).toContain('-');
  });

  it('reads the unquoted speaker form', () => {
    expect(parseQuotebook('Jon: What exactly is this proving out?')[0]).toMatchObject({
      author: 'Jon',
    });
  });

  it('does not mistake a colon inside a sentence for a speaker', () => {
    // The guard that keeps `I have one rule: never lie` a quote rather than
    // attributing it to "I have one rule".
    expect(parseQuotebook('I have one rule: never lie')[0].author).toBe('Unknown');
  });

  it('accepts a bare-name attribution with no separator', () => {
    expect(parseQuotebook('"That truck kisses his father on the lips" jeron')[0]).toMatchObject({
      author: 'jeron',
    });
  });

  it('does not attribute "he said" as a name', () => {
    // Without the capitalisation guard this becomes author "he said".
    expect(parseQuotebook('"Hello" he said')[0].author).toBe('Unknown');
  });

  it('groups a multi-speaker exchange under all its speakers', () => {
    const [q] = parseQuotebook('Jack: "Because of consent?" Max:"Myth."');
    expect(q.author).toBe('Jack, Max');
    // sortAuthor holds the last speaker, which is what buildBracket groups on.
    expect(q.sortAuthor).toBe('Max');
  });

  it('ignores blank lines', () => {
    expect(parseQuotebook('"one" - A\n\n\n"two" - B')).toHaveLength(2);
  });
});
