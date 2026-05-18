-- Sign2Sign — periodic pruning of code_attempts
-- Run via: supabase db push
--
-- code_attempts grows by one row per validate_route_code() call. Without
-- pruning, the table grows unbounded and the recent-failed-count query
-- (which is indexed and filtered to the last 60s, so still fast) accumulates
-- dead tuples that bloat the table.
--
-- pg_cron schedules a nightly job to delete rows older than 24 hours.
-- The 60-second rate-limit window only ever reads rows < 60s old, so any
-- rows older than a few minutes are pure storage cost.
--
-- pg_cron is preinstalled on Supabase but not enabled by default — this
-- migration enables it. If your project already has it enabled the
-- CREATE EXTENSION is a no-op.

create extension if not exists pg_cron with schema extensions;

-- Idempotent job creation: unschedule any existing job with the same name
-- before scheduling fresh, so re-running the migration doesn't double-book.
do $$
begin
  perform cron.unschedule('prune_code_attempts');
exception when others then
  -- Job didn't exist yet — nothing to unschedule
  null;
end $$;

select cron.schedule(
  'prune_code_attempts',
  '17 3 * * *',  -- daily at 03:17 UTC (odd minute spreads load across cluster)
  $$ delete from public.code_attempts where attempted_at < now() - interval '24 hours' $$
);
