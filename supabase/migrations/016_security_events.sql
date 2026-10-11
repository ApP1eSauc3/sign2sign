-- Sign2Sign — security-event log (open-work #7)
--
-- Written 2026-10-11. Closes the "no security-event logging" failure in
-- docs/SECURITY_CHECKLIST_CROSSCHECK_2026_10_11.md (G-1, L-5).
--
-- What was true before this migration (measured 2026-10-11):
--   * `code_attempts` was the only trail, pruned at 24h by 007.
--   * Supabase Auth's own audit trail is NOT written to the database on this
--     project (`audit_log_disable_postgres: true`), so admin sign-ins, invites
--     and deletions lived only in the platform log store (1 day on Free, 7 on
--     Pro). Nothing survived long enough to investigate an incident.
--
-- Design:
--   1. One append-only table, public.security_events. No client role can
--      read or write it: anon and authenticated hold no privileges and RLS is
--      on with no policies. Liam reads it from the dashboard SQL editor.
--   2. One write path, public.record_security_event(), SECURITY DEFINER.
--      Only service_role (Edge Functions) and supabase_auth_admin (the Auth
--      hook) may execute it. Triggers call it internally.
--   3. What is captured, and by what:
--        auth.<method>          custom_access_token_hook — every NEW session
--                               (password sign-in, MFA verify, reset, invite
--                               accepted). Token refreshes are skipped.
--        job.deleted            trigger on public.jobs
--        route_code.created     trigger on public.route_codes (never the code)
--        admin.invited          invite-admin Edge Function
--        admin.deleted          delete-admin-account Edge Function
--        driver.lockout         validate-code Edge Function (429s)
--      Failed admin sign-ins are NOT capturable here: Supabase only exposes
--      them to a database through the Password Verification hook, which is a
--      Teams/Enterprise feature. On Pro they are in the Auth logs for 7 days.
--   4. Retention: one year (Liam, 2026-10-11), pruned nightly by pg_cron.
--      PRIVACY.md §6 states this; keep the two in step.
--
-- ⚠️ The access-token hook only runs once it is ENABLED in Auth settings
--    (`npm run auth:apply-security -- --dry-run`, then without the flag).
--    Apply this migration first: enabling a hook that does not exist yet
--    breaks every sign-in.

-- ─── 1. Table ────────────────────────────────────────────────────────────────

create table public.security_events (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  -- dotted lowercase, e.g. 'auth.password', 'job.deleted'
  event_type  text not null check (event_type ~ '^[a-z_]+(\.[a-z0-9_/]+)+$'),
  actor_id    uuid,
  actor_email text,
  ip          inet,
  target_id   text,
  detail      jsonb not null default '{}'::jsonb
);

comment on table public.security_events is
  'Append-only security log (migration 016). Written only via record_security_event(); pruned after 1 year.';

-- Time-ordered reads ("what happened this week") and the nightly prune.
create index security_events_occurred_at_idx on public.security_events (occurred_at);
-- "Everything this admin did."
create index security_events_actor_idx on public.security_events (actor_id, occurred_at desc)
  where actor_id is not null;

alter table public.security_events enable row level security;
-- No policies on purpose: with RLS on and none defined, every non-owner role
-- is denied regardless of grants. The revokes below remove the grants too,
-- because the default ACL (001_initial.sql:526-537) hands every new table to
-- anon and authenticated, and the supabase_admin half of that cannot be
-- changed from this project (see 013).
revoke all on table public.security_events from public, anon, authenticated;
revoke all on sequence public.security_events_id_seq from public, anon, authenticated;

-- ─── 2. The single write path ────────────────────────────────────────────────

create or replace function public.record_security_event(
  p_event_type  text,
  p_actor_id    uuid  default null,
  p_actor_email text  default null,
  p_ip          inet  default null,
  p_target_id   text  default null,
  p_detail      jsonb default '{}'::jsonb
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.security_events (event_type, actor_id, actor_email, ip, target_id, detail)
  values (p_event_type, p_actor_id, left(p_actor_email, 320), p_ip, left(p_target_id, 200),
          coalesce(p_detail, '{}'::jsonb));
$$;

revoke all on function public.record_security_event(text, uuid, text, inet, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_security_event(text, uuid, text, inet, text, jsonb)
  to service_role, supabase_auth_admin;

-- ─── 3. Triggers for admin data changes ──────────────────────────────────────
-- AFTER triggers in the same transaction: if the log write fails, the change
-- rolls back with it. A deletion with no record is worse than a failed one.

create or replace function public.log_job_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Job id and route only. The address and client details are customer data
  -- and stay out of the log.
  perform public.record_security_event(
    'job.deleted',
    auth.uid(),
    auth.jwt()->>'email',
    null,
    old.id::text,
    jsonb_build_object('route_code_id', old.route_code_id, 'was_complete', old.is_complete)
  );
  return old;
end;
$$;

create trigger trg_jobs_log_delete
  after delete on public.jobs
  for each row execute function public.log_job_deleted();

create or replace function public.log_route_code_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Never the code itself: it is a live credential until it expires.
  perform public.record_security_event(
    'route_code.created',
    auth.uid(),
    auth.jwt()->>'email',
    null,
    new.id::text,
    jsonb_build_object('driver_slot', new.driver_slot, 'expires_at', new.expires_at)
  );
  return new;
end;
$$;

create trigger trg_route_codes_log_insert
  after insert on public.route_codes
  for each row execute function public.log_route_code_created();

-- Trigger functions are invoked by the trigger, never directly.
revoke all on function public.log_job_deleted() from public, anon, authenticated;
revoke all on function public.log_route_code_created() from public, anon, authenticated;

-- ─── 4. Auth hook: record each new session ───────────────────────────────────
-- Supabase calls this as supabase_auth_admin every time it mints an access
-- token, inside Auth's own transaction. If it raises, the sign-in FAILS
-- (supabase/auth internal/tokens/service.go: the hook error is returned), so
-- the logging is wrapped in its own exception block and can never block a
-- sign-in. The claims are returned untouched.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_method text := event->>'authentication_method';
begin
  if v_method is not null and v_method <> 'token_refresh' then
    begin
      perform public.record_security_event(
        'auth.' || v_method,
        nullif(event->>'user_id', '')::uuid,
        event->'claims'->>'email',
        null,
        null,
        jsonb_build_object('aal', event->'claims'->>'aal', 'session_id', event->'claims'->>'session_id')
      );
    exception when others then
      -- Logged to the database server log; the sign-in proceeds.
      raise warning 'custom_access_token_hook: security event not recorded: %', sqlerrm;
    end;
  end if;
  return jsonb_build_object('claims', event->'claims');
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;

-- ─── 5. Retention: one year ──────────────────────────────────────────────────
-- Same pattern as 007. Unschedule first so re-running this file is safe.

do $$
begin
  perform cron.unschedule('prune_security_events');
exception when others then
  null;  -- not scheduled yet
end;
$$;

select cron.schedule(
  'prune_security_events',
  '23 3 * * *',  -- daily 03:23 UTC, a few minutes after 007's prune
  $$ delete from public.security_events where occurred_at < now() - interval '1 year' $$
);

-- ─── Verify after `supabase db push` ─────────────────────────────────────────
--   select has_table_privilege('anon', 'public.security_events', 'select');           -- false
--   select has_table_privilege('authenticated', 'public.security_events', 'insert');  -- false
--   select has_function_privilege('authenticated',
--     'public.record_security_event(text,uuid,text,inet,text,jsonb)', 'execute');     -- false
--   select jobname, schedule from cron.job where jobname = 'prune_security_events';   -- 1 row
