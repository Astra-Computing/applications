#!/usr/bin/env node
// Refuses to build while a server from a previous build is still listening.
//
// Rebuilding under a live `next start` replaces the hashed chunks the running
// server still advertises. They 404 back as text/html, the browser refuses to
// execute them, React never hydrates - and every page then looks blank or dead
// while handlers silently never fire. It reads exactly like a product bug and
// is not one; it cost an afternoon and produced three separate false bug hunts.
//
// The browser layer has its own build-identity guard, but that only fires when
// the suite runs. The hours were lost during ordinary manual rebuild-and-
// refresh, so the refusal belongs here, in front of every path (R31, KTD12).
//
// Override with UQ_ALLOW_BUILD_OVER_SERVER=1 when you genuinely mean it - a
// CI job building on a machine that happens to serve something else, say.

const net = require('node:net');

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';

if (process.env.UQ_ALLOW_BUILD_OVER_SERVER === '1') {
  process.exit(0);
}

const socket = new net.Socket();
let settled = false;

function done(inUse) {
  if (settled) return;
  settled = true;
  socket.destroy();
  if (!inUse) process.exit(0);

  process.stderr.write(
    '\n' +
    'Refusing to build: something is already listening on port ' + PORT + '.\n' +
    '\n' +
    'Building now would replace the chunks that server is still advertising.\n' +
    'They would 404 back as text/html, the browser would refuse to execute\n' +
    'them, React would never hydrate, and every page would look broken in a\n' +
    'way that reads as a product bug.\n' +
    '\n' +
    'Stop the server first:\n' +
    "  docker exec dev-env sh -c \"pkill -9 -f next-server; pkill -9 -f 'next start'\"\n" +
    '\n' +
    'Then build, then start. Set UQ_ALLOW_BUILD_OVER_SERVER=1 to override.\n' +
    '\n'
  );
  process.exit(1);
}

socket.setTimeout(1500);
socket.once('connect', () => done(true));
socket.once('timeout', () => done(false));
socket.once('error', () => done(false)); // ECONNREFUSED: nothing there, good
socket.connect(PORT, HOST);
