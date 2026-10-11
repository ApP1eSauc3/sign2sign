import { freshDb, as } from './harness.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const db = await freshDb({ upTo: 17 });
let pass = 0;
const ok = (n) => { pass++; console.log('✓', n); };
const call3 = (code, client, ip) => as(db, 'service_role', {},
  `select public.validate_route_code($1, $2::uuid, $3::inet) as s`, [code, client, ip], { keep: true });
const call2 = (code, client) => as(db, 'service_role', {},
  `select public.validate_route_code($1, $2::uuid) as s`, [code, client], { keep: true });

const rc = await db.query(`insert into public.route_codes (code, driver_slot, expires_at) values ('246810', 1, now() + interval '1 day') returning id`);
await db.query(`insert into public.jobs (route_code_id, client_name, address, sign_description, job_type, latitude, longitude, sort_order)
  values ($1, 'C', 'A', 'S', 'install', 1, 1, 1)`, [rc.rows[0].id]);

// Success path returns the payload and records the IP.
const good = await call3('246810', randomUUID(), '198.51.100.7');
assert.equal(good.rows[0].s.code, '246810');
assert.equal(good.rows[0].s.jobs.length, 1);
const rec = await db.query(`select succeeded, host(ip) ip from public.code_attempts order by attempted_at desc limit 1`);
assert.deepEqual(rec.rows[0], { succeeded: true, ip: '198.51.100.7' });
ok('valid code returns the route payload and records the caller IP');

// Per-device limit unchanged: 5 failures then P0005.
const dev = randomUUID();
for (let i = 0; i < 5; i++) assert.equal((await call3('000000', dev, '198.51.100.8')).rows[0].s, null);
const locked = await call3('000000', dev, '198.51.100.8');
assert.equal(locked.code, 'P0005');
ok('per-device lock still trips after 5 failures (P0005)');

// Per-IP: rotating device ids does NOT escape the IP limit.
const ip = '203.0.113.50';
for (let i = 0; i < 30; i++) {
  const r = await call3(String(100000 + i), randomUUID(), ip);
  assert.equal(r.rows[0].s, null, `attempt ${i}: ${r.error}`);
}
const ipLocked = await call3('999999', randomUUID(), ip);
assert.equal(ipLocked.code, 'P0006');
ok('30 failures from one IP with a fresh device id each time trips P0006');

// ...and a correct code from that IP is also refused while locked (no oracle).
const ipLockedGood = await call3('246810', randomUUID(), ip);
assert.equal(ipLockedGood.code, 'P0006');
ok('a locked IP is refused even with the right code (no guessing oracle)');

// Another IP is unaffected.
const other = await call3('246810', randomUUID(), '203.0.113.51');
assert.equal(other.rows[0].s.code, '246810');
ok('other IPs are unaffected');

// Window: failures older than 60s do not count.
await db.query(`update public.code_attempts set attempted_at = now() - interval '61 seconds' where host(ip) = $1`, [ip]);
const after = await call3('246810', randomUUID(), ip);
assert.equal(after.rows[0].s.code, '246810');
ok('the IP lock expires after 60 seconds');

// 2-argument wrapper still works for the currently deployed function (no IP limit).
const w = await call2('246810', randomUUID());
assert.equal(w.rows[0].s.code, '246810');
const wnull = await db.query(`select ip from public.code_attempts order by attempted_at desc limit 1`);
assert.equal(wnull.rows[0].ip, null);
ok('2-argument signature still works and records no IP');

// Grants: only service_role may execute either signature.
for (const role of ['anon', 'authenticated']) {
  const claims = role === 'anon' ? {} : { sub: randomUUID() };
  const a = await as(db, role, claims, `select public.validate_route_code('246810', $1::uuid, '1.2.3.4'::inet)`, [randomUUID()]);
  assert.equal(a.code, '42501', `${role} 3-arg`);
  const b = await as(db, role, claims, `select public.validate_route_code('246810', $1::uuid)`, [randomUUID()]);
  // 2-arg grants are exactly what 006/008/010 left: anon revoked, authenticated
  // kept (010: "admins are already trusted"). CREATE OR REPLACE must not change them.
  if (role === 'anon') assert.equal(b.code, '42501', 'anon 2-arg');
  else assert.ok(b.rows, 'authenticated 2-arg unchanged from 010: ' + b.error);
}
ok('3-arg: service_role only; 2-arg grants unchanged from 006/008/010');

const plan = await db.query(`explain select count(*) from public.code_attempts where ip = '1.2.3.4' and succeeded = false and attempted_at > now() - interval '60 seconds'`);
console.log('  plan:', plan.rows.map((r) => r['QUERY PLAN']).join(' | ').slice(0, 160));
const idx = await db.query(`select indexdef from pg_indexes where indexname = 'code_attempts_ip_failed_recent_idx'`);
assert.equal(idx.rows.length, 1);
ok('partial index on (ip, attempted_at) for failures exists');

console.log(`\n${pass} checks passed`);
