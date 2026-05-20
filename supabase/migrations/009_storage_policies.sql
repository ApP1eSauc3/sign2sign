-- Sign2Sign — job-photos storage bucket lockdown
-- Run via: supabase db push
--
-- The job-photos bucket was created via the dashboard with no migration-tracked
-- RLS policies. This migration makes its access model explicit and secure.
--
-- Threat: job photos carry GPS coordinates and are tied to client addresses.
-- If the bucket is public, or anon has bucket-wide SELECT, an attacker with
-- the anon key can LIST every object (supabase.storage.from('job-photos')
-- .list()), then sign and download every photo — a full data exfiltration.
--
-- Access model:
--   - Bucket is PRIVATE. No object is reachable without an explicit policy
--     or a signed URL.
--   - Drivers (anon) may INSERT only, and only under the jobs/<uuid>/ prefix.
--     They cannot SELECT/LIST/UPDATE/DELETE — this prevents enumeration and
--     prevents overwriting or deleting an uploaded photo (the DB photo_key is
--     already write-once; this closes the storage side too).
--   - Admins (authenticated) may SELECT, so the route-detail screen can show
--     completed photos via signed URLs.
--
-- Note: because anon can no longer SELECT, drivers cannot generate signed URLs
-- to re-display a previously uploaded photo on a fresh app session. The
-- DriverJobScreen handles a null signed URL gracefully (the "Photo captured"
-- state still shows). If driver photo re-display is needed later, cache the
-- local image URI on-device rather than re-opening anon read access.

-- Ensure the bucket exists and is private, with server-side size + mime limits.
-- 8 MiB ceiling is generous for the client-resized ~300–600 KB uploads but
-- still blocks someone from using the bucket as free storage for huge files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-photos',
  'job-photos',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Idempotent: drop any prior policy with these names (e.g. dashboard-created)
-- before recreating, so re-running the migration is safe.
drop policy if exists "Drivers upload job photos"  on storage.objects;
drop policy if exists "Admins read job photos"      on storage.objects;
drop policy if exists "Public read job photos"      on storage.objects;
drop policy if exists "Public upload job photos"    on storage.objects;

-- Drivers (anon): INSERT only, scoped to the jobs/ prefix.
create policy "Drivers upload job photos"
  on storage.objects for insert to anon
  with check (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = 'jobs'
  );

-- Admins (authenticated): read for the route-detail screen / auditing.
create policy "Admins read job photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'job-photos');

-- No anon SELECT/UPDATE/DELETE and no anon INSERT outside jobs/ — anything
-- not matched by a policy is denied by default under RLS.
