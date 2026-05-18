-- Sign2Sign — rate-limited driver code validation + data leak closure
-- Run via: supabase db push
--
-- Closes two related gaps in the driver authentication model.
--
--   1. Brute-force on driver codes
--      The 6-digit code IS the driver credential. Prior to this migration,
--      `route_codes` was readable by anon (RLS allowed all active codes).
--      An attacker with the anon key could enumerate `code` values until
--      one matched (expected hits in tens of thousands of tries, no rate
--      limit at the Supabase API).
--
--   2. Cross-route job exposure
--      `jobs` was anon-readable for any active route_code via RLS. Once an
--      attacker had any active code (or even just enumerated `route_codes.id`,
--      which was visible), they could read EVERY job for EVERY driver that
--      day — addresses, client names, agent contact info.
--
-- Fix:
--   A. Hide the `code` column from anon via column-level SELECT grants.
--      anon retains SELECT on (id, driver_slot, created_date, expires_at,
--      is_active) so existing RLS subqueries on jobs ("exists ... from
--      route_codes where id = X and is_active and expires_at > now()")
--      continue to work without modification.
--   B. Revoke SELECT on `jobs` from anon entirely. Drivers reach jobs only
--      through SECURITY DEFINER RPCs that validate route ownership.
--   C. Add `validate_route_code(p_code, p_client_id)` as the one entry point
--      for driver authentication. Rate-limited by client_id (a UUID the
--      driver app persists in SecureStore — see RouteCodeService).
--   D. Add `recover_existing_photo(p_job_id, p_route_code)` for the P0002
--      photo write-once race — was previously a direct anon SELECT on jobs.
--   E. Narrow the duplicate-location trigger to fire only when address or
--      job_type actually change, so driver UPDATEs (photo/is_complete only)
--      don't invoke it. Mark it SECURITY DEFINER for defence-in-depth.


-- ─── 1. Attempt log ──────────────────────────────────────────────────────────
-- One row per validation attempt. Pruning is not strictly required — the
-- 60-second lookback window means stale rows have no functional effect.

create table public.code_attempts (
  id bigserial primary key,
  client_id uuid not null,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null
);

create index code_attempts_client_recent_idx
  on public.code_attempts (client_id, attempted_at desc)
  where succeeded = false;

alter table public.code_attempts enable row level security;
-- No policies: anon has no direct access. The RPCs below are SECURITY DEFINER
-- and write to this table as the owner.


-- ─── 2. validate_route_code() ────────────────────────────────────────────────
-- Returns the route + jobs payload as JSONB on success, NULL on invalid/expired
-- code. Raises P0005 when the caller has made 5+ failed attempts in 60 seconds.

create or replace function public.validate_route_code(p_code text, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent_failed int;
  v_route record;
  v_jobs jsonb;
begin
  if p_client_id is null then
    raise exception using errcode = '22023',
      message = 'client_id required';
  end if;

  -- Count only failed attempts so a legitimate success doesn't lock the
  -- caller out of their own subsequent app launches.
  select count(*) into v_recent_failed
    from public.code_attempts
   where client_id = p_client_id
     and succeeded = false
     and attempted_at > now() - interval '60 seconds';

  if v_recent_failed >= 5 then
    raise exception using errcode = 'P0005',
      message = 'rate_limited: too many code attempts; wait 60 seconds and try again';
  end if;

  select id, code, driver_slot
    into v_route
    from public.route_codes
   where code = p_code
     and is_active = true
     and expires_at > now()
   limit 1;

  if not found then
    insert into public.code_attempts (client_id, succeeded) values (p_client_id, false);
    return null;
  end if;

  insert into public.code_attempts (client_id, succeeded) values (p_client_id, true);

  select coalesce(jsonb_agg(j order by j.sort_order), '[]'::jsonb) into v_jobs
    from (
      select id, client_name, agent_name, agent_email, address, sign_description,
             job_type, latitude, longitude, sort_order, is_complete,
             photo_key, photo_gps_lat, photo_gps_lng, photo_timestamp
        from public.jobs
       where route_code_id = v_route.id
    ) j;

  return jsonb_build_object(
    'id', v_route.id,
    'code', v_route.code,
    'driver_slot', v_route.driver_slot,
    'jobs', v_jobs
  );
end;
$$;

grant execute on function public.validate_route_code(text, uuid) to anon, authenticated;


-- ─── 3. recover_existing_photo() ─────────────────────────────────────────────
-- Driver-callable replacement for the P0002 write-once recovery path.
-- Returns the canonical photo metadata when an offline-retry upload hits
-- the write-once trigger. Validates that the calling code actually owns
-- the target job — prevents using this RPC to read jobs from other routes.

create or replace function public.recover_existing_photo(
  p_job_id     uuid,
  p_route_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route_id uuid;
  v_row record;
begin
  select id into v_route_id
    from public.route_codes
   where code = p_route_code
     and is_active = true
     and expires_at > now();

  if v_route_id is null then
    raise exception using errcode = '28000', message = 'invalid_route_code';
  end if;

  select photo_key, photo_gps_lat, photo_gps_lng, photo_timestamp
    into v_row
    from public.jobs
   where id = p_job_id
     and route_code_id = v_route_id;

  if not found or v_row.photo_key is null then
    return null;
  end if;

  return jsonb_build_object(
    'photo_key', v_row.photo_key,
    'photo_gps_lat', v_row.photo_gps_lat,
    'photo_gps_lng', v_row.photo_gps_lng,
    'photo_timestamp', v_row.photo_timestamp
  );
end;
$$;

grant execute on function public.recover_existing_photo(uuid, text) to anon, authenticated;


-- ─── 4. Lock down direct anon SELECT ────────────────────────────────────────
-- Column-level on route_codes: hide `code` so anon cannot enumerate or filter
-- by it. The remaining columns are needed by existing RLS subqueries on jobs
-- ("exists ... from route_codes rc where rc.id = X and rc.is_active and
-- rc.expires_at > now()"), which reference id/is_active/expires_at only.

revoke select on table public.route_codes from anon;
grant  select (id, driver_slot, created_date, expires_at, is_active)
       on table public.route_codes to anon;

-- jobs: anon has no SELECT path. All reads route through the RPCs above.
-- The driver UPDATE policy (002) does not reference jobs in its USING
-- clause — it only checks route_codes — so revoking jobs SELECT does not
-- break driver writes.
revoke select on table public.jobs from anon;


-- ─── 5. Narrow + harden the duplicate-location trigger ──────────────────────
-- The 005 trigger fires on EVERY jobs UPDATE, which means driver photo/
-- is_complete UPDATEs invoke it. Under the new anon grants, the trigger's
-- subqueries against jobs/route_codes would fail.
--
-- The fix has two parts:
--   (a) Only fire when address or job_type actually changes — the only
--       cases where the duplicate check is meaningful.
--   (b) SECURITY DEFINER so the function runs as owner and retains SELECT
--       on both tables regardless of the invoking role.

drop trigger if exists trg_jobs_no_duplicate_location on public.jobs;

create or replace function public.jobs_no_duplicate_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date;
begin
  select created_date into v_date
    from public.route_codes
   where id = new.route_code_id;

  if exists (
    select 1
      from public.jobs j
      join public.route_codes rc on rc.id = j.route_code_id
     where lower(j.address) = lower(new.address)
       and j.job_type        = new.job_type
       and j.id             <> new.id
       and rc.created_date   = v_date
  ) then
    raise exception using
      errcode = 'P0004',
      message = format(
        'duplicate_location: %s (%s) is already assigned to a driver today',
        new.address, new.job_type
      );
  end if;

  return new;
end;
$$;

create trigger trg_jobs_no_duplicate_location
  before insert or update of address, job_type
  on public.jobs
  for each row
  execute function public.jobs_no_duplicate_location();
