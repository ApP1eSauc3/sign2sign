// Open-work #12: "an integration test that touches real grants". The photo
// write was broken in prod for two months (migration 006 revoked anon SELECT
// on jobs, which also removed PostgREST's ability to filter the UPDATE) while
// 60 mocked unit tests stayed green. This runs the driver path against real
// Postgres grants and RLS, as the roles the API actually uses.
import { freshDb, as } from './harness.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const db = await freshDb();
let pass = 0;
const ok = (n) => { pass++; console.log('✓', n); };

const rc = await db.query(`insert into public.route_codes (code, driver_slot, expires_at) values ('482913', 1, now() + interval '1 day') returning id`);
const RC = rc.rows[0].id;
const job = await db.query(`insert into public.jobs (route_code_id, client_name, address, sign_description, job_type, latitude, longitude, sort_order)
  values ($1, 'C', '9 Driver Rd', 'S', 'install', -31.95, 115.86, 1) returning id`, [RC]);
const JOB = job.rows[0].id;
const KEY = `jobs/${JOB}/1760000000000.jpg`;

// 1. A driver validates the code (through the Edge Function's service role).
const session = await as(db, 'service_role', {}, `select public.validate_route_code('482913', $1::uuid, '203.0.113.1'::inet) as s`, [randomUUID()], { keep: true });
assert.equal(session.rows[0].s.jobs[0].id, JOB);
ok('code validation returns the route and its job');

// 2. The direct REST write that broke in 2026 is refused at the privilege layer.
const direct = await as(db, 'anon', {}, `update public.jobs set photo_key = $1 where id = $2`, [KEY, JOB]);
assert.equal(direct.code, '42501');
ok('anon cannot UPDATE jobs directly (013)');

// 3. The real path: record_job_photo() as anon writes the photo row.
const rec = await as(db, 'anon', {}, `select public.record_job_photo($1, '482913', $2, -31.95, 115.86, now()) as r`, [JOB, KEY], { keep: true });
assert.ok(rec.rows, 'anon can execute record_job_photo: ' + rec.error);
assert.equal(rec.rows[0].r.ok, true);
const stored = await db.query(`select photo_key from public.jobs where id = $1`, [JOB]);
assert.equal(stored.rows[0].photo_key, KEY);
ok('a driver CAN write a photo row through record_job_photo (the #12 assertion)');

// 4. Its guards hold.
const wrongKey = await as(db, 'anon', {}, `select public.record_job_photo($1, '482913', 'jobs/other/1.jpg', 1, 1, now()) as r`, [JOB]);
assert.equal(wrongKey.rows[0].r.error, 'invalid_photo_key');
const wrongCode = await as(db, 'anon', {}, `select public.record_job_photo($1, '000000', $2, 1, 1, now()) as r`, [JOB, KEY]);
assert.equal(wrongCode.rows[0].r.error, 'invalid_route_code');
const again = await as(db, 'anon', {}, `select public.record_job_photo($1, '482913', $2, 0, 0, now()) as r`, [JOB, `jobs/${JOB}/1760000000001.jpg`]);
assert.equal(again.rows[0].r.already_recorded, true);
assert.equal(again.rows[0].r.photo_key, KEY);
ok('photo key pinned to the job, code checked, first write wins');

// 5. Mark complete through complete_job().
const done = await as(db, 'anon', {}, `select public.complete_job($1, '482913') as r`, [JOB], { keep: true });
assert.ok(done.rows, 'complete_job: ' + done.error);
const complete = await db.query(`select is_complete from public.jobs where id = $1`, [JOB]);
assert.equal(complete.rows[0].is_complete, true);
ok('complete_job marks the job complete');

console.log(`\n${pass} checks passed`);
