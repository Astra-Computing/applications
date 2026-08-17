-- One-time setup: run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- against your project before deploying. Not applied automatically.

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

-- Physically delete rooms that haven't been written to in 24h (matches the
-- privacy notice shown in-app: data is deleted when a game ends or within
-- 24 hours automatically). updated_at refreshes on every game action, so
-- this is "24h since last activity," not "24h since creation" — an
-- intentional, low-risk sliding window (games run minutes, not hours).
create extension if not exists pg_cron;

select cron.schedule(
  'cleanup-old-games',
  '0 * * * *', -- hourly
  $$ delete from game_states where updated_at < now() - interval '24 hours' $$
);

-- Optional: also sweep stale rate-limit rows so the table doesn't grow
-- unbounded. Not required for correctness (expired rows are already ignored
-- by the application logic), just housekeeping.
select cron.schedule(
  'cleanup-old-rate-limits',
  '0 * * * *',
  $$ delete from rate_limits where reset_at < now() - interval '1 hour' $$
);
