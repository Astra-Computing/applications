-- Tables. Run this in the Supabase SQL Editor (Dashboard → SQL Editor) against
-- your project before deploying, then run cron.sql. Neither is applied
-- automatically, and both are safely re-runnable.
--
-- Split from the former setup.sql so the test suite can apply the schema alone:
-- cron.sql needs the pg_cron extension, which does not exist on a stock
-- Postgres image, and the scheduled sweeps are not wanted against a test
-- database anyway. Keeping one source of truth for the tables is why this is a
-- split rather than a copy — a duplicated DDL drifts the first time a column
-- is added.

-- Game state, one row per room. envelope holds the AES-256-GCM-encrypted
-- GameState JSON (iv/tag/enc), same encryption as before — only the storage
-- medium changed from Redis to Postgres.
create table if not exists game_states (
  room_code  text primary key,
  envelope   jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rate limiting for POST /api/game/create, keyed by requester IP.
-- Replaces the old in-process Map (and the Upstash-Redis version before it) —
-- checked/updated inside a single Postgres transaction in the route handler.
create table if not exists rate_limits (
  ip       text primary key,
  count    int not null default 1,
  reset_at timestamptz not null
);
