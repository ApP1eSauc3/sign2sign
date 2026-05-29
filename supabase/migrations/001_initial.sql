--
-- PostgreSQL database dump
--

\restrict t4gf7GV7pe6zIi3RK1EqKcozkOxDH1iCOcJiKDwVftrDWUxkHJyrdx2rHC11b5v

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: complete_job(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_job(p_job_id uuid, p_route_code text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_route_id uuid;
  v_job      jobs%rowtype;
begin
  -- Validate the route code: must be active and not expired
  select id into v_route_id
    from route_codes
   where code       = p_route_code
     and is_active  = true
     and expires_at > now();

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


--
-- Name: jobs_complete_is_monotonic(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.jobs_complete_is_monotonic() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if old.is_complete = true and new.is_complete = false then
    raise exception using
      errcode = 'P0001',
      message = 'concurrency_violation: is_complete cannot be reverted once set';
  end if;
  return new;
end;
$$;


--
-- Name: jobs_no_duplicate_location(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.jobs_no_duplicate_location() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
       and j.id             <> new.id          -- exclude the row being updated
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


--
-- Name: jobs_photo_key_write_once(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.jobs_photo_key_write_once() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if old.photo_key is not null
     and new.photo_key is not null
     and old.photo_key <> new.photo_key
  then
    raise exception using
      errcode = 'P0002',
      message = 'concurrency_violation: photo_key is write-once; cannot replace an existing photo';
  end if;
  return new;
end;
$$;


--
-- Name: jobs_require_photo_for_complete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.jobs_require_photo_for_complete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.is_complete = true and coalesce(new.photo_key, old.photo_key) is null then
    raise exception using
      errcode = 'P0003',
      message = 'business_rule: photo_key must be set before is_complete can be true';
  end if;
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    route_code_id uuid,
    client_name text NOT NULL,
    agent_name text,
    agent_email text,
    address text NOT NULL,
    sign_description text NOT NULL,
    job_type text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    sort_order integer NOT NULL,
    is_complete boolean DEFAULT false NOT NULL,
    photo_key text,
    photo_gps_lat double precision,
    photo_gps_lng double precision,
    photo_timestamp timestamp with time zone,
    CONSTRAINT jobs_job_type_check CHECK ((job_type = ANY (ARRAY['install'::text, 'removal'::text])))
);


--
-- Name: route_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.route_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    driver_slot integer NOT NULL,
    created_date date DEFAULT CURRENT_DATE NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: route_codes route_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_codes
    ADD CONSTRAINT route_codes_code_key UNIQUE (code);


--
-- Name: route_codes route_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_codes
    ADD CONSTRAINT route_codes_pkey PRIMARY KEY (id);


--
-- Name: one_active_code_per_slot_per_day; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX one_active_code_per_slot_per_day ON public.route_codes USING btree (driver_slot, created_date) WHERE (is_active = true);


--
-- Name: jobs trg_jobs_complete_monotonic; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_jobs_complete_monotonic BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.jobs_complete_is_monotonic();


--
-- Name: jobs trg_jobs_no_duplicate_location; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_jobs_no_duplicate_location BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.jobs_no_duplicate_location();


--
-- Name: jobs trg_jobs_photo_gate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_jobs_photo_gate BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.jobs_require_photo_for_complete();


--
-- Name: jobs trg_jobs_photo_write_once; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_jobs_photo_write_once BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.jobs_photo_key_write_once();


--
-- Name: jobs jobs_route_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_route_code_id_fkey FOREIGN KEY (route_code_id) REFERENCES public.route_codes(id) ON DELETE CASCADE;


--
-- Name: jobs Admins can insert jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert jobs" ON public.jobs FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: route_codes Admins can insert route codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert route codes" ON public.route_codes FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: jobs Admins can read all jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all jobs" ON public.jobs FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: route_codes Admins can read all route codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all route codes" ON public.route_codes FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: jobs Admins can update jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update jobs" ON public.jobs FOR UPDATE USING ((auth.role() = 'authenticated'::text));


--
-- Name: route_codes Admins can update route codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update route codes" ON public.route_codes FOR UPDATE USING ((auth.role() = 'authenticated'::text));


--
-- Name: jobs Drivers can update photo fields for active jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Drivers can update photo fields for active jobs" ON public.jobs FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.route_codes rc
  WHERE ((rc.id = jobs.route_code_id) AND (rc.is_active = true) AND (rc.expires_at > now()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.route_codes rc
  WHERE ((rc.id = jobs.route_code_id) AND (rc.is_active = true) AND (rc.expires_at > now())))));


--
-- Name: route_codes Public read active codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read active codes" ON public.route_codes FOR SELECT USING (((is_active = true) AND (expires_at > now())));


--
-- Name: jobs Public read jobs for active codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read jobs for active codes" ON public.jobs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.route_codes rc
  WHERE ((rc.id = jobs.route_code_id) AND (rc.is_active = true) AND (rc.expires_at > now())))));


--
-- Name: jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: route_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.route_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION complete_job(p_job_id uuid, p_route_code text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.complete_job(p_job_id uuid, p_route_code text) TO anon;
GRANT ALL ON FUNCTION public.complete_job(p_job_id uuid, p_route_code text) TO authenticated;
GRANT ALL ON FUNCTION public.complete_job(p_job_id uuid, p_route_code text) TO service_role;


--
-- Name: FUNCTION jobs_complete_is_monotonic(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.jobs_complete_is_monotonic() TO anon;
GRANT ALL ON FUNCTION public.jobs_complete_is_monotonic() TO authenticated;
GRANT ALL ON FUNCTION public.jobs_complete_is_monotonic() TO service_role;


--
-- Name: FUNCTION jobs_no_duplicate_location(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.jobs_no_duplicate_location() TO anon;
GRANT ALL ON FUNCTION public.jobs_no_duplicate_location() TO authenticated;
GRANT ALL ON FUNCTION public.jobs_no_duplicate_location() TO service_role;


--
-- Name: FUNCTION jobs_photo_key_write_once(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.jobs_photo_key_write_once() TO anon;
GRANT ALL ON FUNCTION public.jobs_photo_key_write_once() TO authenticated;
GRANT ALL ON FUNCTION public.jobs_photo_key_write_once() TO service_role;


--
-- Name: FUNCTION jobs_require_photo_for_complete(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.jobs_require_photo_for_complete() TO anon;
GRANT ALL ON FUNCTION public.jobs_require_photo_for_complete() TO authenticated;
GRANT ALL ON FUNCTION public.jobs_require_photo_for_complete() TO service_role;


--
-- Name: TABLE jobs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.jobs TO anon;
GRANT ALL ON TABLE public.jobs TO authenticated;
GRANT ALL ON TABLE public.jobs TO service_role;


--
-- Name: COLUMN jobs.is_complete; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(is_complete) ON TABLE public.jobs TO anon;


--
-- Name: COLUMN jobs.photo_key; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(photo_key) ON TABLE public.jobs TO anon;


--
-- Name: COLUMN jobs.photo_gps_lat; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(photo_gps_lat) ON TABLE public.jobs TO anon;


--
-- Name: COLUMN jobs.photo_gps_lng; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(photo_gps_lng) ON TABLE public.jobs TO anon;


--
-- Name: COLUMN jobs.photo_timestamp; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(photo_timestamp) ON TABLE public.jobs TO anon;


--
-- Name: TABLE route_codes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.route_codes TO anon;
GRANT ALL ON TABLE public.route_codes TO authenticated;
GRANT ALL ON TABLE public.route_codes TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict t4gf7GV7pe6zIi3RK1EqKcozkOxDH1iCOcJiKDwVftrDWUxkHJyrdx2rHC11b5v

