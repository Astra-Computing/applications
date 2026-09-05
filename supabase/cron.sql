-- Scheduled cleanup. Run this in the Supabase SQL Editor AFTER schema.sql.
-- Not applied automatically, and safely re-runnable.
--
-- Deliberately NOT applied to the test database: pg_cron does not exist on a
-- stock Postgres image, and a scheduled delete is not something a test suite
-- should have running underneath it.

-- Physically delete rooms that haven't been written to in 24h (matches the
-- privacy notice shown in-app: data is deleted when a game ends or within
-- 24 hours automatically). updated_at refreshes on every game action, so
-- this is "24h since last activity," not "24h since creation" — an
-- intentional, low-risk sliding window (games run minutes, not hours).
create extension if not exists pg_cron;

-- cron.schedule errors if the job name already exists, so drop first to keep
-- this whole script safely re-runnable. cron.unschedule throws when the job is
-- absent, hence the exception swallow.
do $$ begin perform cron.unschedule('cleanup-old-games'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('cleanup-old-rate-limits'); exception when others then null; end $$;

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
