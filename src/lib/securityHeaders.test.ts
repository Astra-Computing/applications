import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

/**
 * The Content Security Policy, asserted without a browser.
 *
 * The browser layer already fails on any CSP violation (R18), but it does not
 * run in CI (KTD8) and takes five minutes locally. That leaves the one directive
 * whose absence has actually cost this project two releases guarded only by a
 * suite nobody runs on a pull request.
 *
 * The champion fireworks never fired on any deployed build. `canvas-confetti`
 * renders through an OffscreenCanvas worker built from a `blob:` URL; with no
 * `worker-src`, the CSP falls back to `script-src`, which does not allow
 * `blob:`, and the browser blocks the worker ASYNCHRONOUSLY - `new Worker()`
 * does not throw. The component mounted, the effect ran, the canvas was present
 * and sized and visible, and nothing drew. Every automated signal said fine.
 *
 * So the directive is asserted here too: milliseconds, no browser, and it runs
 * in the job that gates every pull request. A PR that deletes `worker-src` now
 * goes red in CI rather than shipping a silently dead celebration.
 */

const require = createRequire(import.meta.url);
// next.config.js is CommonJS and outside the TS project's rootDir.
const nextConfig = require('../../next.config.js') as {
  headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>>;
};

async function cspFor(source: string): Promise<string> {
  const routes = await nextConfig.headers();
  const route = routes.find(r => r.source === source);
  if (!route) throw new Error(`next.config.js sets no headers for "${source}"`);
  const csp = route.headers.find(h => h.key === 'Content-Security-Policy');
  if (!csp) throw new Error(`"${source}" carries no Content-Security-Policy header`);
  return csp.value;
}

describe('Content Security Policy', () => {
  it("keeps worker-src 'self' blob:, without which the celebration silently dies", async () => {
    const csp = await cspFor('/');
    expect(csp).toContain("worker-src 'self' blob:");
  });

  it('does not widen script-src to blob: instead', async () => {
    // The tempting "fix" when the celebration breaks, and the wrong one: it
    // permits every blob-built script on the page, not just the worker.
    const scriptSrc = (await cspFor('/')).split(';').map(d => d.trim()).find(d => d.startsWith('script-src'));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain('blob:');
  });

  it('keeps the directives the app depends on to render at all', async () => {
    const csp = await cspFor('/');
    // img-src blob: is the confetti canvas; connect-src 'self' is the 2s poll.
    expect(csp).toContain('img-src');
    expect(csp).toContain('blob:');
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("default-src 'self'");
  });

  it('applies the policy to every route the app serves, not only the landing page', async () => {
    const routes = await nextConfig.headers();
    const withoutCsp = routes
      .filter(r => !r.headers.some(h => h.key === 'Content-Security-Policy'))
      .map(r => r.source);
    expect(withoutCsp, 'these routes carry no CSP').toEqual([]);
    expect(routes.length).toBeGreaterThan(0);
  });

  it('still sets the other security headers', async () => {
    const routes = await nextConfig.headers();
    const keys = routes[0].headers.map(h => h.key);
    expect(keys).toContain('X-Frame-Options');
    expect(keys).toContain('X-Content-Type-Options');
    expect(keys).toContain('Referrer-Policy');
    expect(keys).toContain('Permissions-Policy');
  });
});
