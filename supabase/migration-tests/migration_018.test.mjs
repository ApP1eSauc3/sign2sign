import { freshDb, as } from './harness.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const db = await freshDb({ upTo: 18 });
let pass = 0;
const ok = (n) => { pass++; console.log('✓', n); };

const PLAIN = randomUUID();   // admin without MFA
const MFA = randomUUID();     // admin with a verified factor
const PENDING = randomUUID(); // admin who started enrolment but never verified
await db.query(`insert into auth.users (id, email) values ($1,'plain@x'),($2,'mfa@x'),($3,'pending@x')`, [PLAIN, MFA, PENDING]);
await db.query(`insert into auth.mfa_factors (user_id, status) values ($1,'verified'),($2,'unverified')`, [MFA, PENDING]);

const rc = await db.query(`insert into public.route_codes (code, driver_slot, expires_at) values ('135790', 1, now() + interval '1 day') returning id`);
const RC = rc.rows[0].id;
const jobIns = `insert into public.jobs (route_code_id, client_name, address, sign_description, job_type, latitude, longitude, sort_order)
  values ('${RC}', 'C', 'A', 'S', 'install', 1, 1, 1) returning id`;
await db.query(jobIns);
await db.query(`insert into storage.buckets (id, name, public) values ('job-photos','job-photos',false) on conflict do nothing`);
await db.query(`insert into storage.objects (bucket_id, name) values ('job-photos', 'jobs/x/1.jpg')`);

const s = (sub, aal) => ({ sub, aal, email: 'e' });
const count = async (claims, table) => {
  const r = await as(db, 'authenticated', claims, `select count(*)::int n from ${table}`);
  return r.rows ? r.rows[0].n : r.error;
};

assert.equal(await count(s(PLAIN, 'aal1'), 'public.jobs'), 1);
assert.equal(await count(s(PLAIN, 'aal1'), 'public.route_codes'), 1);
ok('admin without MFA keeps full access at aal1 (optional MFA does not lock anyone out)');

assert.equal(await count(s(MFA, 'aal1'), 'public.jobs'), 0);
assert.equal(await count(s(MFA, 'aal1'), 'public.route_codes'), 0);
assert.equal(await count(s(MFA, 'aal1'), 'storage.objects'), 0);
ok('admin WITH a verified factor sees nothing at aal1 (jobs, route_codes, photos)');

for (const [label, sql] of [
  ['insert job', jobIns.replace("'A'", "'Unique St'")],
  ['insert route code', `insert into public.route_codes (code, driver_slot, expires_at) values ('111111', 2, now() + interval '1 day')`],
]) {
  const r = await as(db, 'authenticated', s(MFA, 'aal1'), sql);
  assert.ok(r.error && /row-level security/.test(r.error), `${label} at aal1 must be refused: ${JSON.stringify(r)}`);
}
const upd = await as(db, 'authenticated', s(MFA, 'aal1'), `update public.route_codes set is_active = false returning id`);
assert.deepEqual(upd.rows, []);
const del = await as(db, 'authenticated', s(MFA, 'aal1'), `delete from public.jobs returning id`);
assert.deepEqual(del.rows, []);
ok('…and cannot insert, update, or delete at aal1');

assert.equal(await count(s(MFA, 'aal2'), 'public.jobs'), 1);
assert.equal(await count(s(MFA, 'aal2'), 'public.route_codes'), 1);
const ins2 = await as(db, 'authenticated', s(MFA, 'aal2'), jobIns.replace("'A'", "'B'"));
assert.ok(ins2.rows, 'insert at aal2: ' + ins2.error);
ok('admin with MFA has full access at aal2');

assert.equal(await count(s(PENDING, 'aal1'), 'public.jobs'), 1);
ok('an unverified (abandoned) enrolment does not lock the admin out');

assert.equal(await count({ sub: MFA }, 'public.jobs'), 0);
ok('a token with no aal claim is treated as aal1');

// Drivers (anon) are untouched: the driver RPC path still works.
const drv = await as(db, 'service_role', {}, `select public.validate_route_code('135790', $1::uuid, '1.2.3.4'::inet) as s`, [randomUUID()]);
assert.equal(drv.rows[0].s.code, '135790');
ok('driver code validation unaffected');

const anonExec = await as(db, 'anon', {}, `select public.mfa_requirement_met()`);
assert.equal(anonExec.code, '42501');
ok('anon cannot call mfa_requirement_met()');

const pol = await db.query(`select tablename, permissive from pg_policies where policyname = 'Admins who enrolled MFA must use it' order by tablename`);
assert.deepEqual(pol.rows, [
  { tablename: 'jobs', permissive: 'RESTRICTIVE' },
  { tablename: 'objects', permissive: 'RESTRICTIVE' },
  { tablename: 'route_codes', permissive: 'RESTRICTIVE' },
]);
ok('three RESTRICTIVE policies present');

console.log(`\n${pass} checks passed`);
