import { testConnectionString } from './db';

/**
 * Global setup for the API layer.
 *
 * Owns two things. The first, from U1, is the refusal: nothing in this project
 * runs until the resolved database URL has been checked, because the failure
 * that matters is a connection string that is present and points at the live
 * Supabase project. `next start` forces `NODE_ENV=production`, so Next loads
 * `.env.local` — which holds exactly that string — and ignores `.env.test`
 * entirely. Only the process environment outranks it, so the suite reads from
 * there and aborts here if what it finds looks like production.
 *
 * The second, from U4, is the application lifecycle: build once, start against
 * the test database, wait for `/api/health` to report `db: up`, and tear the
 * process down afterwards. Vitest has no `webServer` option, so that is
 * explicit work and is not written yet.
 */
export default async function setup() {
  // Throws on a missing string, and on one that names a Supabase host.
  const url = testConnectionString();

  const shown = url.replace(/:\/\/[^@]*@/, '://***@');
  console.log(`[test-db] ${shown}`);

  return async () => {
    // Teardown for the server U4 will start here.
  };
}
