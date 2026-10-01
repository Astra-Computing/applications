import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

/**
 * scripts/guard-build.js - the refusal in front of `npm run build`.
 *
 * It is the one executable on the production build path, and it fails OPEN on
 * a socket error or a timeout, on purpose: a Vercel build must never be blocked
 * by it. That makes a broken guard silent - it would let every build through
 * and report nothing. So both halves are asserted here: it refuses when a
 * server is listening, and it lets the build through when nothing is.
 *
 * Each case runs the real script in a child process with PORT pointed at a
 * port this test controls, so the developer's own port 3000 never matters.
 */

const SCRIPT = path.resolve(import.meta.dirname, 'guard-build.js');

type Result = { code: number; stderr: string };

// Async on purpose: the listening server lives in THIS process, so the event
// loop must stay free to accept the child's connection.
function runGuard(env: Record<string, string>): Promise<Result> {
  return new Promise(resolve => {
    execFile(
      process.execPath,
      [SCRIPT],
      { env: { ...process.env, UQ_ALLOW_BUILD_OVER_SERVER: '', ...env } },
      (err, _stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
        resolve({ code, stderr });
      },
    );
  });
}

let server: net.Server | null = null;

function listen(): Promise<number> {
  return new Promise((resolve, reject) => {
    server = net.createServer(socket => socket.destroy());
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server!.address() as net.AddressInfo).port));
  });
}

// A port that was free a moment ago: bind to 0, read the port, close.
async function freePort(): Promise<number> {
  const port = await listen();
  await new Promise<void>(resolve => server!.close(() => resolve()));
  server = null;
  return port;
}

afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = null;
});

describe('guard-build', () => {
  it('refuses to build while a server is listening on the port', async () => {
    const port = await listen();
    const { code, stderr } = await runGuard({ PORT: String(port) });
    expect(code).toBe(1);
    expect(stderr).toContain(`Refusing to build: something is already listening on port ${port}`);
  });

  it('lets the build through when nothing is listening', async () => {
    const port = await freePort();
    const { code, stderr } = await runGuard({ PORT: String(port) });
    expect(code).toBe(0);
    expect(stderr).toBe('');
  });

  it('lets the build through over a live server when overridden', async () => {
    const port = await listen();
    const { code } = await runGuard({ PORT: String(port), UQ_ALLOW_BUILD_OVER_SERVER: '1' });
    expect(code).toBe(0);
  });
});
