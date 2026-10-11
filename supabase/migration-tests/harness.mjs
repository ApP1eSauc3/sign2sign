// Migration test harness: PGlite (Postgres 17 compiled to WASM) plus the
// smallest set of Supabase stand-ins the migrations need: the API roles,
// auth.uid()/jwt()/role() reading request.jwt.claims as PostgREST sets it,
// auth.users / auth.mfa_factors, a cron.schedule() that records jobs, and the
// storage tables. It replays supabase/migrations in order, so a test runs
// against the same grants and RLS as prod, as the role the API would use.
//
// What it cannot tell you: anything about the real Auth server, pg_cron
// actually firing, or prod having drifted from these files. `npm run
// security:probe` checks the live project; this checks the files.
//
//   npm run test:migrations
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create role supabase_admin nologin;
create schema auth; create schema extensions; create schema cron; create schema storage;
create table auth.users (id uuid primary key, email text);
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null, status text not null, factor_type text default 'totp');
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid::bigint $$;
create function cron.unschedule(p_name text) returns boolean language sql as $$
  with d as (delete from cron.job where jobname = p_name returning 1) select exists (select 1 from d) $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema auth, storage, cron to anon, authenticated, service_role, supabase_auth_admin;
grant select on auth.mfa_factors to authenticated;
-- Supabase grants table privileges on storage.objects to API roles; RLS gates them.
grant select, insert, update, delete on storage.objects, storage.buckets to anon, authenticated;
drop schema public cascade;
`;

function clean(sql, file) {
  let out = sql
    .split('\n')
    .filter((l) => !l.startsWith('\\'))                 // psql meta-commands (\\restrict)
    .join('\n')
    .replace(/create extension if not exists pg_cron with schema extensions;/gi, '-- (pg_cron stubbed)');
  // The dump sets row_security = off and an empty search_path for the session;
  // restore what a normal PostgREST connection has.
  if (file.startsWith('001_')) out += '\nset search_path to public, extensions;\nset row_security = on;\n';
  return out;
}

export async function freshDb({ upTo = Infinity, extra = [] } = {}) {
  const db = new PGlite();
  await db.exec(STUBS);
  const files = fs.readdirSync(MIG).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    const n = Number(f.slice(0, 3));
    if (n > upTo) continue;
    try {
      await db.exec(clean(fs.readFileSync(path.join(MIG, f), 'utf8'), f));
    } catch (e) {
      throw new Error(`${f}: ${e.message}`);
    }
  }
  for (const f of extra) await db.exec(clean(fs.readFileSync(f, 'utf8'), path.basename(f)));
  return db;
}

// Run `fn` as a role with JWT claims, inside a transaction that is rolled back
// unless keep=true. Returns { rows } or { error }.
export async function as(db, role, claims, sql, params = [], { keep = false } = {}) {
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role, ...claims })]);
    await db.exec(`set local role ${role}`);
    const res = await db.query(sql, params);
    await db.exec(keep ? 'commit' : 'rollback');
    return { rows: res.rows };
  } catch (e) {
    await db.exec('rollback');
    return { error: e.message, code: e.code };
  }
}
