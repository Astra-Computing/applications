// Standalone compile-and-run check for player identity (U1) and for name
// normalisation and prototype-safe player lookups (U2).
//
// There is no test framework in this repo. The established pattern is to
// compile the touched `src/lib` modules with tsc into a scratch directory
// OUTSIDE the repo and assert against the emitted JavaScript - the same way
// the parser was verified. From inside dev-env, at the repo root:
//
//   npx tsc src/lib/gameLogic.ts src/lib/types.ts \
//     --outDir /workspace/tools/uqcheck1 --module commonjs --target es2020 --skipLibCheck
//   node _check_identity.js
//
// Set UQ_CHECK_OUT if the compiled output lives somewhere else. The directory
// must be outside the repo: tsc emits .js next to nothing here, and a stray
// build inside src/ would be picked up by Next.
//
// Two kinds of assertion live here:
//   1. Pure-logic assertions against the compiled `playerNameForToken`.
//   2. Source assertions over the route and player-page files, because the
//      whole point of U1 is a header that must no longer appear in them.
//      A header the server never reads cannot break a request that still
//      sends it (KTD2), so the absence of the read *is* that guarantee.

const fs   = require('fs');
const path = require('path');

const OUT  = process.env.UQ_CHECK_OUT || '/workspace/tools/uqcheck1';
const REPO = __dirname;

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${label}\n          ${e.message}`);
  }
}
function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const gameLogic = require(path.join(OUT, 'gameLogic.js'));
const { playerNameForToken, normalizePlayerName, refreshHeartbeat, joinGame, MAX_NAME_LEN } = gameLogic;

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

// Comments are allowed to name the header - several of them explain why it is
// gone and why one arriving from an old client is ignored. Code is not.
function readCode(rel) {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// A state whose player names are exactly the ones an HTTP header cannot carry
// (curly apostrophe, emoji, Latin-Extended, CJK) plus one that collides with a
// member of Object.prototype.
const NAMES = {
  'O’Brien': 'tok-obrien',
  'Jon 🍻': 'tok-jon',
  'Łukasz': 'tok-lukasz',
  'ゆき': 'tok-yuki',
  'toString': 'tok-tostring',
};

function makeState(playerTokens) {
  return {
    roomCode: 'ABCD',
    hostToken: 'host-token',
    status: 'voting',
    round: 1,
    totalRounds: 2,
    matchups: [],
    bracketHistory: [],
    participants: Object.fromEntries(Object.keys(playerTokens).map(n => [n, Date.now()])),
    playerTokens,
    champion: null,
    createdAt: Date.now(),
  };
}

console.log('U1 - identify players by token alone\n');

console.log('helper: token -> name');
check('playerNameForToken is exported as a function', () => {
  eq(typeof playerNameForToken, 'function', 'typeof playerNameForToken');
});

const state = makeState({ ...NAMES });
for (const [name, token] of Object.entries(NAMES)) {
  check(`resolves ${JSON.stringify(name)} from its token`, () => {
    eq(playerNameForToken(state, token), name, `playerNameForToken(state, '${token}')`);
  });
}

check('returns null for a token that is not in the room', () => {
  eq(playerNameForToken(state, 'tok-nobody'), null, 'unknown token');
});
check('returns null for an empty / missing token', () => {
  eq(playerNameForToken(state, ''), null, 'empty string token');
  eq(playerNameForToken(state, null), null, 'null token');
  eq(playerNameForToken(state, undefined), null, 'undefined token');
});
check('never matches a value inherited from the prototype chain (KTD8)', () => {
  // playerTokens comes back from JSON as a plain object, but the lookup must
  // not depend on that: an inherited entry is not a player in the room.
  const inherited = Object.create({ 'Ghost': 'tok-inherited' });
  inherited['Real'] = 'tok-real';
  const s = makeState(inherited);
  eq(playerNameForToken(s, 'tok-inherited'), null, 'inherited token');
  eq(playerNameForToken(s, 'tok-real'), 'Real', 'own token alongside an inherited one');
});
check('a name equal to an Object.prototype member is a real player, not a stray function', () => {
  eq(playerNameForToken(state, 'tok-tostring'), 'toString', "the player named 'toString'");
  eq(playerNameForToken(state, String(Object.prototype.toString)), null, 'a stringified prototype member as a token');
});

console.log('\nroutes: no x-player-name anywhere on the authenticated path');
const SOURCES = {
  'src/app/api/game/[code]/route.ts': 'poll',
  'src/app/api/game/[code]/vote/route.ts': 'vote',
  'src/app/api/game/[code]/heartbeat/route.ts': 'heartbeat',
  'src/app/room/[code]/player/page.tsx': 'player page',
};
for (const [rel, label] of Object.entries(SOURCES)) {
  check(`${label} (${rel}) never sends or reads x-player-name`, () => {
    const src = readCode(rel);
    if (src.includes('x-player-name')) {
      throw new Error(`x-player-name still appears in the code of ${rel}`);
    }
  });
}

check('poll, vote and heartbeat resolve the name with playerNameForToken', () => {
  for (const rel of Object.keys(SOURCES)) {
    if (rel.endsWith('page.tsx')) continue;
    const src = read(rel);
    if (!src.includes('playerNameForToken')) {
      throw new Error(`${rel} does not call playerNameForToken`);
    }
  }
});

check('vote and heartbeat still reject a request with no player token', () => {
  for (const rel of ['src/app/api/game/[code]/vote/route.ts', 'src/app/api/game/[code]/heartbeat/route.ts']) {
    const src = read(rel);
    if (!/if\s*\(!playerToken\)/.test(src)) {
      throw new Error(`${rel} lost its missing-token 401 guard`);
    }
  }
});

check('join still carries the name in the JSON body, unchanged', () => {
  const src = read('src/app/api/game/[code]/join/route.ts');
  if (src.includes('x-player-name')) throw new Error('join route now reads a name header');
  if (!/body\.name|const\s*\{\s*name/.test(src)) throw new Error('join route no longer reads name from the body');
});

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
