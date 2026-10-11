-- Sign2Sign — durable per-IP throttle for driver codes
--
-- Written 2026-10-11. Closes H-3 in docs/SECURITY_CHECKLIST_CROSSCHECK_2026_10_11.md.
--
-- Before: two throttles guarded the 6-digit code.
--   * per device: 5 failures / 60s, durable, in validate_route_code (006).
--     But the device id is a UUID the CLIENT sends, so an attacker rotates it
--     per request and this limit never fires for them.
--   * per IP: 30 / 60s in validate-code's memory. Not durable: it resets on
--     every cold start and is not shared between function instances.
-- So against a scripted guesser the only real limit was an in-memory counter.
--
-- After: the IP limit also lives in Postgres. validate-code passes the caller
-- IP (from x-forwarded-for, set by the Supabase gateway) to a new 3-argument
-- validate_route_code, which records it on each attempt and refuses once an
-- IP has 30 failures in 60 seconds (P0006). The in-memory limit stays as a
-- cheap first filter.
--
-- 30 failures, not 5: drivers in one depot can share an office NAT address,
-- and a legitimate morning of typos across four phones must not lock the
-- whole crew out. With four live codes in a six-digit space, 30 guesses a
-- minute from one IP hits a code with probability of roughly 1 in 8,000 per
-- minute. An attacker can multiply that by renting more IPs, which is why the
-- codes also expire each morning.
--
-- ⚠️ Deploy order: apply this migration BEFORE redeploying validate-code.
--    The new function code calls the 3-argument signature, which does not
--    exist until this runs. The old 2-argument signature is kept (as a
--    wrapper) so the currently deployed validate-code v7 keeps working in
--    between.
--
-- Privacy: code_attempts now holds an IP address. It is pruned by 007 within
-- about 48 hours; PRIVACY.md §2 and §6 say so.

alter table public.code_attempts add column ip inet;

-- Serves the per-IP failure count. Partial: only failures are ever counted.
create index code_attempts_ip_failed_recent_idx
  on public.code_attempts (ip, attempted_at desc)
  where ip is not null and succeeded = false;

create or replace function public.validate_route_code(p_code text, p_client_id uuid, p_ip inet)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent_failed int;
  v_ip_recent_failed int;
  v_route record;
  v_jobs jsonb;
begin
  if p_client_id is null then
    raise exception using errcode = '22023',
      message = 'client_id required';
  end if;

  -- Per device (006, unchanged).
  select count(*) into v_recent_failed
    from public.code_attempts
   where client_id = p_client_id
     and succeeded = false
     and attempted_at > now() - interval '60 seconds';

  if v_recent_failed >= 5 then
    raise exception using errcode = 'P0005',
      message = 'rate_limited: too many code attempts; wait 60 seconds and try again';
  end if;

  -- Per IP (new). Skipped when the caller passes no IP.
  if p_ip is not null then
    select count(*) into v_ip_recent_failed
      from public.code_attempts
     where ip = p_ip
       and succeeded = false
       and attempted_at > now() - interval '60 seconds';

    if v_ip_recent_failed >= 30 then
      raise exception using errcode = 'P0006',
        message = 'rate_limited_ip: too many code attempts from this network; wait 60 seconds';
    end if;
  end if;

  select id, code, driver_slot
    into v_route
    from public.route_codes
   where code = p_code
     and is_active = true
     and expires_at > now()
   limit 1;

  if not found then
    insert into public.code_attempts (client_id, succeeded, ip) values (p_client_id, false, p_ip);
    return null;
  end if;

  insert into public.code_attempts (client_id, succeeded, ip) values (p_client_id, true, p_ip);

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

-- Same grant shape as 008/010 left the 2-argument version: service_role only.
revoke all on function public.validate_route_code(text, uuid, inet) from public, anon, authenticated;
grant execute on function public.validate_route_code(text, uuid, inet) to service_role;

-- The 2-argument signature becomes a thin wrapper, so there is one copy of the
-- logic. CREATE OR REPLACE keeps its existing (service_role-only) grants.
create or replace function public.validate_route_code(p_code text, p_client_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.validate_route_code(p_code, p_client_id, null::inet);
$$;

-- ─── Verify after `supabase db push` ─────────────────────────────────────────
--   select has_function_privilege('anon', 'public.validate_route_code(text,uuid,inet)', 'execute');  -- false
--   select has_function_privilege('service_role', 'public.validate_route_code(text,uuid,inet)', 'execute');  -- true
--   select column_name from information_schema.columns
--    where table_name = 'code_attempts' and column_name = 'ip';  -- 1 row
