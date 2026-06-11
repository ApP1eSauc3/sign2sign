-- Sign2Sign — allow admins to delete INCOMPLETE jobs (and nothing else)
-- Run via: supabase db push
--
-- Why this exists: GoogleSheetsService.saveJobsToRoute() has always issued
-- `delete from jobs where route_code_id = …` before inserting an import.
-- No DELETE policy existed on jobs, so under RLS that delete silently
-- affected 0 rows (PostgREST returns error: null for an RLS-filtered
-- delete). The follow-up insert then collided with the
-- trg_jobs_no_duplicate_location trigger (P0004) — meaning an admin could
-- never re-import a corrected sheet to the same route. This migration makes
-- the documented "clear and re-import" semantics real, with one deliberate
-- restriction:
--
--   Completed jobs are NOT deletable from the app. is_complete = true rows
--   are completion evidence (photo key, GPS, timestamp) and survive every
--   re-import. Deleting them requires the service role (dashboard/ops), by
--   design. The client skips re-importing rows that match a completed job.
--
-- Scope notes:
--   - anon gets no DELETE path at all (drivers can never delete jobs).
--   - The policy intentionally has no route/ownership predicate beyond
--     is_complete: admin accounts are mutually trusted office staff, same
--     trust model as the existing "Admins can update jobs" policy.

create policy "Admins can delete incomplete jobs"
  on public.jobs
  for delete
  to authenticated
  using (is_complete = false);
