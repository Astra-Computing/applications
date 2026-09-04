// Standalone assertions for the randomised BYE (U5, R15/R16).
//
// There is no test framework in this repo. The established pattern is to
// compile the touched src/lib modules with tsc into a scratch directory OUTSIDE
// the repo and assert against the emitted JavaScript - the same way the parser
// and player identity were verified. From the repo root, inside dev-env:
//
//   npx tsc src/lib/gameLogic.ts src/lib/types.ts \
//     --outDir /workspace/tools/uqbracket --module commonjs --target es2020 --skipLibCheck
//   node _check_bracket.js
//
// The BYE is random, so every invariant here is asserted over many runs rather
// than one - a single run proves nothing about a randomised choice.

const OUT = process.env.UQ_CHECK_OUT || '/workspace/tools/uqbracket';
const g = require(`${OUT}/gameLogic.js`);

let failed = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
}

const quotes = n =>
  Array.from({ length: n }, (_, i) => ({ text: `quote ${i}`, author: `A${i}` }));

/** Drive a whole game to completion, resolving every matchup by coin flip.
 *  Returns the bracketHistory, which is what the BYE rules are asserted over. */
function playOut(n) {
  let state = g.createGame(quotes(n), 'host-token');
  let guard = 0;
  while (state.status !== 'done' && guard++ < 20) {
    state = { ...state, status: 'voting' };
    state = g.advanceRound(state);
  }
  return state;
}

const byeTextOf = round => {
  const m = round.find(x => x.a === null || x.b === null);
  return m ? (m.a ?? m.b).text : null;
};

// ── R15: round 1's BYE is not always the same slot ────────────────────────────
{
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const pairs = g.buildBracket(quotes(9));
    const idx = pairs.findIndex(([a, b]) => a === null || b === null);
    seen.add(idx);
  }
  check('R15 round-1 BYE lands on more than one slot over 200 builds',
    seen.size > 1, `${seen.size} distinct slots`);
}

// ── R15: the field is intact ─────────────────────────────────────────────────
{
  let ok = true, detail = '';
  for (let i = 0; i < 200; i++) {
    const pairs = g.buildBracket(quotes(9));
    const flat = pairs.flat();
    const present = flat.filter(Boolean).map(q => q.text).sort();
    const nulls = flat.filter(x => x === null).length;
    if (present.length !== 9 || new Set(present).size !== 9 || nulls !== 1) {
      ok = false; detail = `run ${i}: ${present.length} quotes, ${nulls} nulls`; break;
    }
  }
  check('every quote appears exactly once and exactly one BYE exists', ok, detail);
}

// ── R15: an even field still has no BYE ──────────────────────────────────────
{
  let ok = true;
  for (let i = 0; i < 100; i++) {
    const pairs = g.buildBracket(quotes(8));
    if (pairs.flat().some(x => x === null)) { ok = false; break; }
  }
  check('an even field produces no BYE', ok);
}

// ── R16: no quote takes the BYE in two consecutive rounds ────────────────────
{
  let violations = 0, byeRounds = 0, runs = 300;
  for (let i = 0; i < runs; i++) {
    for (const n of [9, 11, 12, 13, 17]) {
      const done = playOut(n);
      const byes = done.bracketHistory.map(byeTextOf);
      byes.forEach((b, r) => {
        if (b !== null) byeRounds++;
        if (b !== null && r > 0 && byes[r - 1] === b) violations++;
      });
    }
  }
  check('R16 no quote receives the BYE in consecutive rounds',
    violations === 0, `${violations} violations across ${byeRounds} BYE rounds`);
}

// ── totalRounds is unchanged for the awkward field sizes ─────────────────────
{
  const expected = { 9: 4, 10: 4, 17: 5, 33: 6 };
  let ok = true, detail = '';
  for (const [n, want] of Object.entries(expected)) {
    const got = g.createGame(quotes(Number(n)), 'h').totalRounds;
    if (got !== want) { ok = false; detail = `${n} quotes gave ${got}, wanted ${want}`; break; }
  }
  check('totalRounds unchanged for 9, 10, 17 and 33 quotes', ok, detail);
}

// ── every game still reaches exactly one champion ────────────────────────────
{
  let ok = true, detail = '';
  for (const n of [3, 5, 9, 11, 12, 13, 17, 33]) {
    for (let i = 0; i < 40; i++) {
      const done = playOut(n);
      if (done.status !== 'done' || !done.champion) {
        ok = false; detail = `${n} quotes did not resolve`; break;
      }
    }
    if (!ok) break;
  }
  check('every field size resolves to a champion', ok, detail);
}

// ── the BYE relocation does not worsen author spreading ──────────────────────
{
  // NOT an absolute guarantee. The snake spread lays the largest author group
  // at slots 0, last, 1, last-1 ... and pairs are adjacent slots, so slots 0
  // and 1 are both the same pair AND the same author. Same-author round-1
  // pairings therefore already happen on an EVEN field, which the BYE
  // relocation never touches. This asserts only that relocating the BYE does
  // not make it worse - fixing the spread itself is out of this plan.
  const clashes = (sameN, otherN) => {
    let c = 0;
    for (let i = 0; i < 300; i++) {
      const qs = [
        ...Array.from({ length: sameN }, (_, k) => ({ text: `same ${k}`, author: "Same" })),
        ...Array.from({ length: otherN }, (_, k) => ({ text: `other ${k}`, author: `Other${k}` })),
      ];
      for (const [a, b] of g.buildBracket(qs)) if (a && b && a.author === b.author) c++;
    }
    return c;
  };
  const even = clashes(6, 8);   // 14 quotes, no BYE, untouched baseline
  const odd = clashes(6, 7);    // 13 quotes, BYE relocated
  check("relocating the BYE does not increase same-author round-1 pairings",
    odd <= even, `odd ${odd} vs even baseline ${even}`);
}

console.log(failed ? `\n${failed} FAILED` : '\nALL CHECKS PASSED');
process.exitCode = failed ? 1 : 0;
