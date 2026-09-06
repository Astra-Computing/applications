# [UN]Quotable

A multiplayer bracket-voting party game. Players submit quotes, then vote them
head-to-head through a knockout bracket until one wins.

**Live:** https://unquotable.626house.casa
**Repo:** `git@github.com:Astra-Computing/applications.git`
**Stack:** Next.js 14 (App Router) · TypeScript · Supabase Postgres · hosted on Vercel

## Layout

This repo holds the app at its root. It previously nested the app under
`apps/bracketapp-web/` as a monorepo; that layer was removed so the repo root
and the app root are the same directory, which matches Vercel's default root
directory and keeps the path short.

```
.                       repo root == app root
├── src/
│   ├── app/            routes (pages + API route handlers)
│   ├── components/     React components
│   └── lib/            game logic, DB access, types
├── public/             static assets
├── supabase/           schema.sql then cron.sql — tables, then scheduled cleanup
├── quotebooks/         real quote source data (untracked, local only)
├── scripts/            guard-build.js — refuses to build under a live server
└── tests/
    ├── support/        test-database access and the server lifecycle
    ├── fixtures/       tracked parser fixtures
    ├── api/            route tests against a real Postgres
    └── e2e/            browser tests, fixtures and the standing guards
```

Unit tests sit beside the code they cover, at `src/lib/*.test.ts`.

## Local development

Code runs inside the `dev-env` Docker container, never on the Windows host:

```
docker exec dev-env npm --prefix /workspace/projects/bracketapp-web run dev
```

The dev server listens on http://localhost:3000.

Note: Turbopack does not detect file changes through Docker on Windows, so a
full server restart is required after every code change.

## Environment

Copy `.env.example` and fill in real values as `.env.local` (never committed):

| Variable | Purpose |
|----------|---------|
| `SUPABASE_DB_URL` | Postgres connection string (transaction pooler, port 6543) |
| `GAME_ENCRYPTION_KEY` | Encrypts the per-room game state stored in Postgres |

The production build must not require these — the database client is created
lazily at request time so that builds succeed without credentials.

## Tests

Three layers. Each runs inside `dev-env`, and the connection string is supplied
**on the command**, never in a `.env` file — see the warning below, which is the
single most important thing on this page.

```bash
export UQ_DB=postgres://uq:uq@test-db:5432/uq_test

# everything that needs no browser. Run this before every commit.
docker exec -w /workspace/projects/bracketapp-web -e SUPABASE_DB_URL=$UQ_DB \
  dev-env npm test

docker exec ... dev-env npm run test:unit        # pure logic, no database
docker exec ... dev-env npm run test:api         # routes against Postgres
docker exec ... dev-env npm run typecheck:tests  # tests are typechecked here,
                                                 # never by `next build`
docker exec ... dev-env npm run test:e2e         # browser layer, ~5 min
```

From Git Bash on Windows, prefix any `docker exec` carrying an absolute
container path with `MSYS_NO_PATHCONV=1`, or the path is rewritten.

`npm run test:e2e` is deliberately **not** part of `npm test`: the fast gate has
to stay fast or people stop running it. Set `UQ_TEST_REUSE_BUILD=1` to skip the
rebuild while iterating on specs — never for a real verification run, because it
will serve a `.next` from before your change and report that as fact.

### The test database

A Postgres service (`test-db`) in the **workspace** `docker-compose.yml`, not in
this repo. Start it from the workspace root on the Windows host; `dev-env` has
no Docker socket. The suite applies `supabase/schema.sql` itself and truncates
between tests. It never applies `cron.sql` — `pg_cron` does not exist on a stock
Postgres image, and a scheduled delete has no business running under a test run.

### Why the connection string cannot live in a .env file

`next start` forces `NODE_ENV=production`, so Next loads **`.env.local`** — which
holds the real production Supabase string — and never reads `.env.test`, which it
consults only when `NODE_ENV` is `test`. Only the process environment outranks
`.env.local`. The suite therefore refuses to start unless the resolved host is on
its allowlist (`test-db`, `localhost`, `127.0.0.1`, `::1`), because what runs
against that connection truncates every table.

### Two habits the suite cannot enforce

- **Run the browser layer before any deploy**, and on any change to the CSP,
  `next.config.js`, build configuration, or dependencies — not only when a change
  touches the interface. The champion fireworks were dead on every deployed build
  for two releases behind a missing `worker-src`; a rule that said "run it when
  the UI changes" would have skipped exactly that commit.
- **Judge how motion feels against the local production build before deploying**,
  with the live site as confirmation rather than as the first look.

### Things worth knowing before you change a test

- **Never rebuild while `npm start` is serving.** It replaces the hashed chunks
  the running server still advertises; they 404 back as `text/html`, React never
  hydrates, and every page looks broken in a way that reads as a product bug.
  `npm run build` refuses to run under a live server, and the browser layer
  refuses to run against a build that is not the one in the tree.
- **"The element exists" is not evidence** for anything canvas-, worker-, or
  GPU-rendered. A canvas that draws nothing is present, sized and visible. Assert
  that something was drawn.
- **Assert randomised behaviour over many runs, not one.** Randomness in the unit
  layer is seeded per test; a failure prints its seed, replayable with
  `UQ_TEST_SEED=<n>`.
- **A room is a budgeted resource.** `/api/game/create` allows ten per hour per
  IP, tests send no `x-forwarded-for`, so the whole browser run shares one budget
  and currently spends seven. Adding roughly three more room-taking tests will
  trip it, and it will look like a server fault rather than a budget.
