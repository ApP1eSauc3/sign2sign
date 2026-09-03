-- Sign2Sign — completion-notice approval state
-- Run via: supabase db push
--
-- Written 2026-09-03, after the first real-device test.
--
--
-- ─── Why ────────────────────────────────────────────────────────────────────
--
-- On Mark Complete the driver app opened a `mailto:` and the DRIVER emailed the
-- client's agent directly, from whatever mail account was configured on their
-- personal phone. Observed on the device build: the notice went out as
-- "Sent from my iPhone".
--
-- That is not the intended flow. A completion notice is a claim that work was
-- done, made to the client on Sign2Sign's behalf. It must be reviewed by an
-- admin and sent from the business account — never composed and sent by the
-- crew member who did the work, from an address the client does not recognise,
-- with a body they can edit before sending, and no record that it happened.
--
-- The driver-side email is removed in the same commit as this migration.
--
--
-- ─── What "pending" means, and why it is derived ────────────────────────────
--
-- There is deliberately no `notice_status` column. A job needs a notice when:
--
--     is_complete = true  AND  agent_email IS NOT NULL  AND  notice_sent_at IS NULL
--
-- Deriving it means `complete_job()` does not change. That RPC is the driver
-- write path, and it was verified end-to-end on real hardware for the first
-- time on 2026-09-03 (camera → upload → record_job_photo → complete). Adding a
-- status column would have meant editing it and re-proving it on a device.
-- Two nullable columns cost nothing and put the risk at zero.
--
-- It also cannot drift: a status column can disagree with `is_complete`, and
-- nothing here would notice. The predicate cannot.
--
--
-- ─── Grants ─────────────────────────────────────────────────────────────────
--
-- No new grants. anon holds no UPDATE on public.jobs at all since 013, so these
-- columns are unreachable by the driver client by construction — the notice
-- state is not the driver's to write. Admin writes go through the existing
-- "Admins can update jobs" policy for the authenticated role.
--
-- No index. The only query is per-route, already served by
-- jobs_route_code_id_idx (013). A partial index on the predicate above would be
-- speculative at this table size — see the 2026-08-21 Big-O review, which found
-- exactly one filter that warranted one.

alter table public.jobs
  add column notice_sent_at timestamptz,
  add column notice_sent_by uuid references auth.users(id) on delete set null;

comment on column public.jobs.notice_sent_at is
  'When an admin approved and sent the completion notice to the agent. NULL on a completed job with an agent_email means the notice is still pending approval.';

comment on column public.jobs.notice_sent_by is
  'The admin who approved the notice. ON DELETE SET NULL — deleting an admin account (Apple 5.1.1(v) self-deletion) must not delete the job history.';


-- ─── Verification ───────────────────────────────────────────────────────────
--
-- Run AFTER `supabase db push` and record the output with a date in
-- CODEBASE_STATUS.md.
--
--   -- (a) Both columns exist and are nullable. Expect two rows, is_nullable=YES.
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_name = 'jobs' and column_name like 'notice_%';
--
--   -- (b) anon still holds no write privilege on jobs. Expect zero rows.
--   select privilege_type, column_name
--     from information_schema.column_privileges
--    where grantee = 'anon' and table_name = 'jobs' and privilege_type <> 'SELECT';
--
--   -- (c) The pending-notice predicate, against the seeded test route.
--   --     Expect the three ZZ TEST jobs once they are complete.
--   select address, is_complete, agent_email, notice_sent_at
--     from public.jobs
--    where is_complete and agent_email is not null and notice_sent_at is null;
