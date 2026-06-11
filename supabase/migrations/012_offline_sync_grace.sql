-- Sign2Sign — 24-hour offline-sync grace window for expired route codes
-- Run via: supabase db push
--
-- The problem this closes: a driver who finishes a job OFFLINE sees an
-- optimistic success, and the photo + mark-complete sit in the on-device
-- queue. Every server-side write path required `expires_at > now()`, and the
-- queue only flushes when the app is next online. If that happens after the
-- code's 06:00 expiry, the queued evidence could NEVER land: the RPCs
-- rejected the code, no error reached the admin, and the work was silently
-- lost while the driver believed it was recorded.
--
-- The fix: writes that FINISH work already assigned to a code are allowed
-- for 24 hours past expiry. Starting anything new is not:
--
--   * validate_route_code() is deliberately untouched — an expired code
--     still cannot open a session, list jobs, or see addresses/agent emails.
--   * Storage INSERT (009) was never expiry-gated, so no change there.
--   * complete_job(), recover_existing_photo(), and the driver UPDATE
--     policy on jobs accept codes where expires_at > now() - interval '24
--     hours' (still requiring is_active = true — a manually revoked or
--     regenerated-over code dies immediately, no grace).
--
-- Interaction with code regeneration: RouteCodeService.generateDailyCodes
-- deactivates only LIVE codes (expires_at > now()). Expired codes keep
-- is_active = true precisely so this grace window works the morning after.
--
-- Residual risk accepted: a leaked code is usable for ~24h after expiry to
-- upload a photo or complete a job on its own route. Both writes are
-- monotonic/write-once (P0001 + P0002 triggers), reads stay blocked, and the
-- photo gate still applies — the abuse surface is "mark a real job done",
-- which the admin sees on the route detail screen.

-- ─── 1. complete_job(): grace on the code validity check ────────────────────
-- Identical to the 001 baseline definition except the expiry predicate.

create or replace function public.complete_job(p_job_id uuid, p_route_code text)
returns json
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_route_id uuid;
  v_job      jobs%rowtype;
begin
  -- Validate the route code: active, and within the 24h sync-grace window.
  -- (Strictly-live validation for NEW work lives in validate_route_code.)
  select id into v_route_id
    from route_codes
   where code       = p_route_code
     and is_active  = true
     and expires_at > now() - interval '24 hours';

  if v_route_id is null then
    return json_build_object('error', 'invalid_route_code');
  end if;

  -- Lock the job row to serialize concurrent mark-complete calls.
  -- The job must belong to the validated route — prevents cross-route writes.
  select * into v_job
    from jobs
   where id            = p_job_id
     and route_code_id = v_route_id
  for update;

  if not found then
    return json_build_object('error', 'job_not_found');
  end if;

  -- Photo gate — authoritative DB-level check (mirrors trigger logic)
  if v_job.photo_key is null then
    return json_build_object('error', 'photo_required');
  end if;

  -- Idempotent: already complete is a success, not an error
  -- (handles offline-queue retries and double-taps safely)
  if v_job.is_complete then
    return json_build_object('ok', true, 'already_complete', true);
  end if;

  update jobs set is_complete = true where id = p_job_id;

  return json_build_object('ok', true);
end;
$$;

-- ─── 2. recover_existing_photo(): same grace ────────────────────────────────
-- Identical to the 006 definition except the expiry predicate. Needed because
-- a queued upload that already landed server-side (P0002 write-once) recovers
-- its canonical metadata through this RPC during the grace-window flush.

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
     and expires_at > now() - interval '24 hours';

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

-- ─── 3. Driver UPDATE policy on jobs: same grace ─────────────────────────────
-- The queued photo upload writes photo_key/GPS/timestamp via a direct UPDATE
-- under this policy. Recreate it with the grace predicate.

drop policy if exists "Drivers can update photo fields for active jobs" on public.jobs;

create policy "Drivers can update photo fields for active jobs"
  on public.jobs
  for update
  using (
    exists (
      select 1
        from public.route_codes rc
       where rc.id = jobs.route_code_id
         and rc.is_active = true
         and rc.expires_at > now() - interval '24 hours'
    )
  )
  with check (
    exists (
      select 1
        from public.route_codes rc
       where rc.id = jobs.route_code_id
         and rc.is_active = true
         and rc.expires_at > now() - interval '24 hours'
    )
  );
