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
├── supabase/           setup.sql — schema and scheduled cleanup
├── quotebooks/         real quote source data (untracked, local only)
└── _pw_*.js            browser diagnostic scripts
```

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
