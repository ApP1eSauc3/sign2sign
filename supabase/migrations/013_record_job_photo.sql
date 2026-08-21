-- Sign2Sign — record_job_photo() RPC, FK/lookup indexes, and anon grant tightening
-- Run via: supabase db push
--
-- Closes open-work #1 (P0 — driver photo upload is dead in prod) and #6
-- (grant tightening). Written 2026-08-21.
--
--
-- ─── Why the driver photo write is broken ───────────────────────────────────
--
-- The handover records this as "anon cannot UPDATE public.jobs". That is not
-- quite the mechanism, and the distinction decides the fix.
--
-- anon DOES hold column-level UPDATE on all five photo columns
-- (001_initial.sql:441-469). What it lost was SELECT:
--
--     006_rate_limit_codes.sql:191   revoke select on table public.jobs from anon;
--
-- with no replacement column grant. Compare the line above it, where
-- route_codes had SELECT revoked and then re-granted as an explicit column
-- subset. jobs got the revoke and no re-grant.
--
-- 006's own comment explains the reasoning:
--
--     "The driver UPDATE policy (002) does not reference jobs in its USING
--      clause — it only checks route_codes — so revoking jobs SELECT does not
--      break driver writes."
--
-- That is true of RLS and false of column privileges. PostgREST compiles
--
--     .from('jobs').update({...}).eq('id', jobId)
--
-- to `UPDATE public.jobs SET ... WHERE id = $1`, and reading a column in a
-- WHERE clause requires SELECT privilege on that column. anon has none, so the
-- statement is rejected at the privilege layer before RLS is ever consulted —
-- which is exactly the symptom that was observed and mis-attributed.
--
-- Two fixes were possible: re-grant `select (id)` and keep the client-side
-- UPDATE, or move the write behind a SECURITY DEFINER RPC like every other
-- driver write already is. This migration takes the second, because it lets us
-- drop anon's direct write access to `jobs` entirely rather than leaving RLS as
-- the only thing standing between a leaked route code and the table.
--
--
-- ─── Note on CREATE INDEX CONCURRENTLY ──────────────────────────────────────
--
-- The indexes below are plain CREATE INDEX, deliberately. Current Supabase CLI
-- versions wrap each migration file in a pipeline/transaction, and
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block — the
-- migration would fail on push (supabase/cli#2898, #5139). `jobs` is small
-- (one route's worth of rows per driver per day), so the brief write lock is
-- measured in milliseconds. If this table ever grows large enough for that to
-- matter, build the index by hand outside a migration.


-- ─── 1. record_job_photo() ──────────────────────────────────────────────────
--
-- Mirrors complete_job() (012) exactly in shape: same 24h offline-sync grace
-- window, same route-ownership check, same FOR UPDATE row lock, same
-- json-with-an-error-key return convention that the client already narrows.
--
-- It also absorbs the P0002 write-once retry. The old client path took two
-- round trips on a mid-request network failure: UPDATE raises P0002, then
-- recover_existing_photo() fetches the canonical row. Here, an existing
-- photo_key simply returns the stored values with already_recorded = true.

create or replace function public.record_job_photo(
  p_job_id     uuid,
  p_route_code text,
  p_photo_key  text,
  p_lat        double precision,
  p_lng        double precision,
  p_timestamp  timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route_id uuid;
  v_job      jobs%rowtype;
  v_ts       timestamptz := coalesce(p_timestamp, now());
begin
  -- Validate the route code: active, and within the 24h sync-grace window.
  -- (Strictly-live validation for NEW work lives in validate_route_code.)
  select id into v_route_id
    from public.route_codes
   where code       = p_route_code
     and is_active  = true
     and expires_at > now() - interval '24 hours';

  if v_route_id is null then
    return jsonb_build_object('error', 'invalid_route_code');
  end if;

  -- The storage key is generated on the device, so it is caller-controlled.
  -- Pin it to this job's own prefix: without this check a driver holding a
  -- valid code could point one job's record at another job's photo, and the
  -- photo IS the completion evidence. Mirrors the client-side key shape in
  -- JobPhotoService (`jobs/<jobId>/<epoch-ms>.<ext>`) and the storage INSERT
  -- policy's `jobs/` prefix restriction (009).
  if p_photo_key is null
     or p_photo_key !~ ('^jobs/' || p_job_id::text || '/[0-9]{1,20}\.(jpg|png|webp)$')
  then
    return jsonb_build_object('error', 'invalid_photo_key');
  end if;

  -- GPS is completion evidence too — reject impossible fixes rather than
  -- storing them. NULL is not acceptable: the whole point of the column is to
  -- record where the work happened.
  if p_lat is null or p_lng is null
     or p_lat  not between -90  and 90
     or p_lng  not between -180 and 180
  then
    return jsonb_build_object('error', 'invalid_location');
  end if;

  -- Lock the job row to serialize concurrent uploads for the same job.
  -- The job must belong to the validated route — prevents cross-route writes.
  select * into v_job
    from public.jobs
   where id            = p_job_id
     and route_code_id = v_route_id
  for update;

  if not found then
    return jsonb_build_object('error', 'job_not_found');
  end if;

  -- Write-once. An earlier attempt already landed; the client just never saw
  -- the response. Return the canonical row rather than raising P0002 and
  -- making the caller do a second round trip to recover it.
  if v_job.photo_key is not null then
    return jsonb_build_object(
      'ok',               true,
      'already_recorded', true,
      'photo_key',        v_job.photo_key,
      'photo_gps_lat',    v_job.photo_gps_lat,
      'photo_gps_lng',    v_job.photo_gps_lng,
      'photo_timestamp',  v_job.photo_timestamp
    );
  end if;

  update public.jobs
     set photo_key       = p_photo_key,
         photo_gps_lat   = p_lat,
         photo_gps_lng   = p_lng,
         photo_timestamp = v_ts
   where id = p_job_id;

  return jsonb_build_object(
    'ok',               true,
    'already_recorded', false,
    'photo_key',        p_photo_key,
    'photo_gps_lat',    p_lat,
    'photo_gps_lng',    p_lng,
    'photo_timestamp',  v_ts
  );
end;
$$;

-- Least privilege, following 010: strip the PUBLIC default before granting the
-- two roles that actually call it. Without the revoke, `public` retains EXECUTE
-- and the grant below is decorative.
revoke all on function public.record_job_photo(uuid, text, text, double precision, double precision, timestamptz) from public;
grant execute on function public.record_job_photo(uuid, text, text, double precision, double precision, timestamptz) to anon, authenticated;


-- ─── 2. Remove anon's direct write access to jobs ───────────────────────────
--
-- With the photo write behind record_job_photo() and the completion write
-- already behind complete_job(), anon has no remaining reason to hold UPDATE
-- on any column of jobs.

revoke update (photo_key, photo_gps_lat, photo_gps_lng, photo_timestamp, is_complete)
  on table public.jobs from anon;

-- The driver UPDATE policy is now unreachable — a policy cannot grant access
-- the privilege layer has already refused. Dropping it prevents a future
-- reader from re-granting UPDATE and silently reopening the direct path.
--
-- Safe to drop: admin updates run under the separate "Admins can update jobs"
-- policy (001_initial.sql:324), which is untouched.
drop policy if exists "Drivers can update photo fields for active jobs" on public.jobs;


-- ─── 3. Indexes ─────────────────────────────────────────────────────────────
--
-- 3a. The unindexed foreign key. Postgres never indexes the referencing side,
--     and route_code_id is the hottest filter in the application:
--
--       RouteCodeService.getRouteJobs        select ... where route_code_id = $1
--       GoogleSheetsService.saveJobsToRoute  delete ... where route_code_id = $1
--                                            select ... where route_code_id = $1
--       validate_route_code()                the job fetch
--       route_codes ON DELETE CASCADE        (001_initial.sql:289)
--
--     Every one of those is a sequential scan today, over a table that only
--     grows: saveJobsToRoute deliberately deletes only incomplete jobs, so
--     completed work accumulates as permanent completion evidence.

create index if not exists jobs_route_code_id_idx
  on public.jobs (route_code_id);

-- 3b. The duplicate-location trigger's lookup. jobs_no_duplicate_location()
--     (006) runs, per inserted row:
--
--       where lower(j.address) = lower(new.address) and j.job_type = ...
--
--     lower(address) is not indexable without a functional index, so a k-row
--     import costs k full scans of jobs — O(k*N) against a table that never
--     shrinks. The expression must match the trigger's predicate exactly for
--     the planner to use it.
--
--     Note the trigger fires only on INSERT or UPDATE OF address, job_type
--     (narrowed in 006), so this index serves imports, not driver writes.

create index if not exists jobs_lower_address_job_type_idx
  on public.jobs (lower(address), job_type);


-- ─── 4. Grant tightening (open-work #6) ─────────────────────────────────────
--
-- anon is an UNAUTHENTICATED role. Drivers hold a six-digit code, not a
-- session, so everything anon can reach is reachable by anyone with the
-- published anon key. Only RLS stood between that and INSERT/DELETE/TRUNCATE
-- on jobs and ALL on route_codes.

revoke insert, delete, truncate, references, trigger on table public.jobs from anon;

-- route_codes: strip everything, then restore exactly the column-level SELECT
-- subset that 006 established (referenced by the remaining RLS policy
-- predicates). Net effect: anon loses INSERT/UPDATE/DELETE/TRUNCATE.
revoke all on table public.route_codes from anon;
grant select (id, driver_slot, created_date, expires_at, is_active)
  on table public.route_codes to anon;

-- The sharpest edge in the baseline: ALTER DEFAULT PRIVILEGES ... GRANT ALL ON
-- TABLES TO anon means every table created from now on is granted to anon
-- automatically, so a single forgotten `enable row level security` ships a
-- publicly writable table. This only affects FUTURE tables; existing grants are
-- unchanged by it.
--
-- Wrapped: ALTER DEFAULT PRIVILEGES FOR ROLE <r> must be executed by a member
-- of <r>. Depending on which role runs the migration, the supabase_admin
-- variant may not be permitted — that is not a reason to fail the whole push,
-- so it degrades to a notice and is listed in the verification block below.
do $$
begin
  alter default privileges for role postgres in schema public revoke all on tables from anon;
exception when insufficient_privilege then
  raise notice 'skipped: default privileges for role postgres (insufficient privilege) — run manually';
end $$;

do $$
begin
  alter default privileges for role supabase_admin in schema public revoke all on tables from anon;
exception when insufficient_privilege then
  raise notice 'skipped: default privileges for role supabase_admin (insufficient privilege) — run manually';
end $$;


-- ─── 5. Verification ────────────────────────────────────────────────────────
--
-- Run these AFTER `supabase db push` and record the output with a date in
-- CODEBASE_STATUS.md. Per CLAUDE.md → Documentation Integrity Rules, a
-- deployed-state claim needs evidence, not intention.
--
--   -- (a) anon holds no write privilege on jobs. Expect zero rows.
--   select privilege_type, column_name
--     from information_schema.column_privileges
--    where grantee = 'anon' and table_name = 'jobs' and privilege_type <> 'SELECT'
--   union all
--   select privilege_type, null
--     from information_schema.table_privileges
--    where grantee = 'anon' and table_name = 'jobs' and privilege_type <> 'SELECT';
--
--   -- (b) The RPC exists and anon can execute it. Expect one row, true.
--   select proname,
--          has_function_privilege('anon', oid, 'execute') as anon_can_execute
--     from pg_proc
--    where proname = 'record_job_photo';
--
--   -- (c) Both indexes exist. Expect two rows.
--   select indexname from pg_indexes
--    where tablename = 'jobs'
--      and indexname in ('jobs_route_code_id_idx', 'jobs_lower_address_job_type_idx');
--
--   -- (d) The planner actually uses the FK index (not a seq scan).
--   explain (analyze, buffers)
--     select * from public.jobs where route_code_id = '00000000-0000-0000-0000-000000000000';
--
--   -- (e) Future tables no longer auto-grant to anon. Expect no anon entry.
--   select defaclrole::regrole, defaclacl
--     from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
--    where n.nspname = 'public' and d.defaclobjtype = 'r';
--
--   -- (f) End-to-end, as anon, with a live code and one of its jobs:
--   --     expect {"ok": true, "already_recorded": false, ...}
--   --     then a second identical call: {"ok": true, "already_recorded": true}
