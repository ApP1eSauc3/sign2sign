-- Sign2Sign — enforce two-step sign-in in the database for admins who use it
--
-- Written 2026-10-11. Pairs with the optional TOTP enrolment added to the
-- Account screen (A-1 in docs/SECURITY_CHECKLIST_CROSSCHECK_2026_10_11.md;
-- Liam chose optional, not required).
--
-- Why the database and not just the app: after a password sign-in, an admin
-- with a verified authenticator has an aal1 session until they enter the code.
-- If only the app enforced the second step, someone holding that admin's
-- password could skip the code screen and call the REST API directly with the
-- aal1 token. These RESTRICTIVE policies make the database refuse that token.
--
-- Pattern: Supabase's documented "enforce MFA for users who have enrolled"
-- policy (supabase.com/docs/guides/auth/auth-mfa), moved into one function so
-- every table applies exactly the same rule. Restrictive policies are ANDed
-- with the existing permissive ones, so this only ever removes access.
--
-- Scope: role `authenticated` only (admins). Drivers are `anon` and reach data
-- through SECURITY DEFINER functions, so they are unaffected.

create or replace function public.mfa_requirement_met()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      or not exists (
        select 1
          from auth.mfa_factors f
         where f.user_id = auth.uid()
           and f.status = 'verified'
      );
$$;

comment on function public.mfa_requirement_met() is
  'True unless the caller has a verified MFA factor but a session below aal2 (migration 018).';

revoke all on function public.mfa_requirement_met() from public, anon;
grant execute on function public.mfa_requirement_met() to authenticated;

-- `(select ...)` so Postgres evaluates the function once per statement, not
-- once per row (Supabase RLS performance guidance).

create policy "Admins who enrolled MFA must use it"
  on public.jobs
  as restrictive
  for all
  to authenticated
  using ((select public.mfa_requirement_met()))
  with check ((select public.mfa_requirement_met()));

create policy "Admins who enrolled MFA must use it"
  on public.route_codes
  as restrictive
  for all
  to authenticated
  using ((select public.mfa_requirement_met()))
  with check ((select public.mfa_requirement_met()));

-- Job photos: admins read them through signed URLs, which are minted with the
-- caller's token, so the same rule applies to the storage objects.
create policy "Admins who enrolled MFA must use it"
  on storage.objects
  as restrictive
  for all
  to authenticated
  using ((select public.mfa_requirement_met()))
  with check ((select public.mfa_requirement_met()));

-- ─── Verify after `supabase db push` ─────────────────────────────────────────
--   select tablename, policyname, permissive from pg_policies
--    where policyname = 'Admins who enrolled MFA must use it';
--   -- 3 rows (jobs, route_codes, objects), permissive = 'RESTRICTIVE'
