import { freshDb, as } from './harness.mjs';
import assert from 'node:assert/strict';

const db = await freshDb({ upTo: 16 });
const ADMIN = '11111111-1111-1111-1111-111111111111';
const admin = { sub: ADMIN, email: 'admin@example.com', aal: 'aal1' };
let pass = 0;
const ok = (name) => { pass++; console.log('✓', name); };

// Seed a route code + job as the table owner.
await db.query(`insert into auth.users (id, email) values ($1, 'admin@example.com')`, [ADMIN]);
const rc = await as(db, 'authenticated', admin,
  `insert into public.route_codes (code, driver_slot, created_date, expires_at, is_active)
   values ('123456', 1, current_date, now() + interval '1 day', true) returning id`, [], { keep: true });
assert.ok(rc.rows, 'admin inserts route code: ' + rc.error);
const rcId = rc.rows[0].id;
ok('admin can still create a route code with the trigger in place');

let ev = await db.query(`select * from public.security_events order by id`);
assert.equal(ev.rows.length, 1);
assert.equal(ev.rows[0].event_type, 'route_code.created');
assert.equal(ev.rows[0].actor_id, ADMIN);
assert.equal(ev.rows[0].actor_email, 'admin@example.com');
assert.equal(ev.rows[0].target_id, rcId);
assert.ok(!JSON.stringify(ev.rows[0].detail).includes('123456'), 'code must not be logged');
ok('route_code.created logged with actor, target, and without the code');

const job = await db.query(
  `insert into public.jobs (route_code_id, client_name, address, sign_description, job_type, latitude, longitude, sort_order)
   values ($1, 'Client', '1 Test St', 'Sign', 'install', -31.9, 115.8, 1) returning id`, [rcId]);
const jobId = job.rows[0].id;
const del = await as(db, 'authenticated', admin, `delete from public.jobs where id = $1 returning id`, [jobId], { keep: true });
assert.ok(del.rows && del.rows.length === 1, 'admin deletes incomplete job: ' + del.error);
ev = await db.query(`select * from public.security_events where event_type = 'job.deleted'`);
assert.equal(ev.rows.length, 1);
assert.equal(ev.rows[0].target_id, jobId);
assert.deepEqual(ev.rows[0].detail, { route_code_id: rcId, was_complete: false });
assert.ok(!JSON.stringify(ev.rows[0]).includes('1 Test St'), 'address must not be logged');
ok('job.deleted logged with route and completion state, without the address');

// Client roles cannot read, write, or call the recorder.
for (const role of ['anon', 'authenticated']) {
  const claims = role === 'anon' ? {} : admin;
  const r1 = await as(db, role, claims, `select count(*) from public.security_events`);
  assert.equal(r1.code, '42501', `${role} select: ${JSON.stringify(r1)}`);
  const r2 = await as(db, role, claims, `insert into public.security_events (event_type) values ('auth.fake')`);
  assert.equal(r2.code, '42501', `${role} insert`);
  const r3 = await as(db, role, claims, `delete from public.security_events`);
  assert.equal(r3.code, '42501', `${role} delete`);
  const r4 = await as(db, role, claims, `select public.record_security_event('auth.fake')`);
  assert.equal(r4.code, '42501', `${role} execute recorder`);
  const r5 = await as(db, role, claims, `select public.custom_access_token_hook('{}'::jsonb)`);
  assert.equal(r5.code, '42501', `${role} execute hook`);
}
ok('anon and authenticated cannot read, insert, delete, or call the recorder/hook');

// service_role (Edge Functions) can record.
const sr = await as(db, 'service_role', {}, `select public.record_security_event('admin.invited', $1::uuid, 'admin@example.com', '203.0.113.9'::inet, null, '{"invited_email":"new@example.com"}')`, [ADMIN], { keep: true });
assert.ok(sr.rows, 'service_role records: ' + sr.error);
ok('service_role can record events');

// The hook: records new sessions, skips refreshes, returns claims untouched.
const claims = { sub: ADMIN, email: 'admin@example.com', aal: 'aal1', session_id: 's1', role: 'authenticated', amr: [{ method: 'password', timestamp: 1 }] };
const hookCall = (method) => as(db, 'supabase_auth_admin', {},
  `select public.custom_access_token_hook($1::jsonb) as out`,
  [JSON.stringify({ user_id: ADMIN, claims, authentication_method: method })], { keep: true });
const before = (await db.query(`select count(*)::int n from public.security_events where event_type like 'auth.%'`)).rows[0].n;
const h1 = await hookCall('password');
assert.ok(h1.rows, 'hook as supabase_auth_admin: ' + h1.error);
assert.deepEqual(h1.rows[0].out, { claims });
const h2 = await hookCall('token_refresh');
assert.deepEqual(h2.rows[0].out, { claims });
const h3 = await hookCall('totp');
const auths = (await db.query(`select event_type, detail from public.security_events where event_type like 'auth.%' order by id`)).rows;
assert.equal(auths.length - before, 2);
assert.deepEqual(auths.map((r) => r.event_type), ['auth.password', 'auth.totp']);
assert.deepEqual(auths[0].detail, { aal: 'aal1', session_id: 's1' });
ok('hook logs password and totp sessions, skips token_refresh, returns claims unchanged');

// Method names with a slash are valid event types.
const h4 = await hookCall('sso/saml');
assert.ok(h4.rows);
assert.equal((await db.query(`select count(*)::int n from public.security_events where event_type = 'auth.sso/saml'`)).rows[0].n, 1);
ok('slash-containing methods (sso/saml) are accepted by the event_type check');

// A logging failure must NOT block sign-in: break the recorder and call the hook.
await db.exec(`alter table public.security_events add constraint force_fail check (false) not valid`);
const h5 = await as(db, 'supabase_auth_admin', {}, `select public.custom_access_token_hook($1::jsonb) as out`,
  [JSON.stringify({ user_id: ADMIN, claims, authentication_method: 'password' })]);
assert.ok(h5.rows, 'hook must not raise when logging fails: ' + h5.error);
assert.deepEqual(h5.rows[0].out, { claims });
// ...whereas a trigger-logged admin action is rolled back if it cannot be logged.
const rc2 = await as(db, 'authenticated', admin,
  `insert into public.route_codes (code, driver_slot, created_date, expires_at, is_active)
   values ('654321', 2, current_date, now() + interval '1 day', true) returning id`);
assert.ok(rc2.error, 'route code insert must fail when it cannot be logged');
await db.exec(`alter table public.security_events drop constraint force_fail`);
ok('hook swallows logging failure (sign-in survives); audited admin writes fail closed');

// Retention job scheduled, and it deletes only rows older than a year.
const job16 = await db.query(`select schedule, command from cron.job where jobname = 'prune_security_events'`);
assert.equal(job16.rows.length, 1);
await db.query(`insert into public.security_events (event_type, occurred_at) values ('auth.password', now() - interval '366 days'), ('auth.password', now() - interval '364 days')`);
const n0 = (await db.query(`select count(*)::int n from public.security_events`)).rows[0].n;
await db.exec(job16.rows[0].command);
const n1 = (await db.query(`select count(*)::int n from public.security_events`)).rows[0].n;
assert.equal(n0 - n1, 1);
ok('nightly prune is scheduled and removes only events older than one year');

// Idempotent re-run of the cron block (unschedule then schedule).
await db.exec(`do $$ begin perform cron.unschedule('prune_security_events'); exception when others then null; end $$;`);
assert.equal((await db.query(`select count(*)::int n from cron.job where jobname='prune_security_events'`)).rows[0].n, 0);
ok('unschedule works (re-running the cron block is safe)');

// Invalid event types are rejected.
const bad = await as(db, 'service_role', {}, `select public.record_security_event('Not Valid')`);
assert.ok(bad.error && /check/.test(bad.error));
ok('malformed event types are rejected');

console.log(`\n${pass} checks passed`);
