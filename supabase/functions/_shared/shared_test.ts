// deno test supabase/functions/_shared/   (npm run test:functions)
import { assertEquals } from 'jsr:@std/assert@1';
import { checkRecentAuth, decodeJwtPayload, REAUTH_WINDOW_SECONDS } from './recentAuth.ts';
import { clientIp } from './clientIp.ts';
import { recordSecurityEvent } from './securityEvents.ts';

const NOW = 1_800_000_000;
const amr = (method: string, ageSeconds: number) => ({ method, timestamp: NOW - ageSeconds });

Deno.test('recentAuth: fresh password, no MFA → ok', () => {
  assertEquals(checkRecentAuth({ aal: 'aal1', amr: [amr('password', 30)] }, false, NOW), { ok: true });
});

Deno.test('recentAuth: password exactly at the window edge → ok; one second older → reauth', () => {
  assertEquals(checkRecentAuth({ amr: [amr('password', REAUTH_WINDOW_SECONDS)] }, false, NOW).ok, true);
  const r = checkRecentAuth({ amr: [amr('password', REAUTH_WINDOW_SECONDS + 1)] }, false, NOW);
  assertEquals(r.ok ? null : r.error, 'reauth_required');
});

Deno.test('recentAuth: an old sign-in kept alive by refreshes is not enough', () => {
  const r = checkRecentAuth({ aal: 'aal1', amr: [amr('password', 3 * 86400)] }, false, NOW);
  assertEquals(r.ok ? null : r.error, 'reauth_required');
});

Deno.test('recentAuth: email-code (otp/recovery) sessions do not count as re-authentication', () => {
  for (const method of ['otp', 'recovery', 'invite', 'magiclink', 'token_refresh']) {
    const r = checkRecentAuth({ amr: [amr(method, 5)] }, false, NOW);
    assertEquals(r.ok ? null : r.error, 'reauth_required', method);
  }
});

Deno.test('recentAuth: MFA user at aal1 → mfa_required even with a fresh password', () => {
  const r = checkRecentAuth({ aal: 'aal1', amr: [amr('password', 5)] }, true, NOW);
  assertEquals(r.ok ? null : r.error, 'mfa_required');
});

Deno.test('recentAuth: MFA user at aal2 with a fresh TOTP → ok', () => {
  const p = { aal: 'aal2', amr: [amr('totp', 10), amr('password', 7200)] };
  assertEquals(checkRecentAuth(p, true, NOW), { ok: true });
});

Deno.test('recentAuth: MFA user at aal2 but TOTP and password both stale → reauth with the code prompt', () => {
  const r = checkRecentAuth({ aal: 'aal2', amr: [amr('totp', 3600), amr('password', 7200)] }, true, NOW);
  assertEquals(r.ok ? null : [r.error, r.message], ['reauth_required', 'Enter the code from your authenticator app to continue.']);
});

Deno.test('recentAuth: timestamps far in the future are rejected; small skew tolerated', () => {
  assertEquals(checkRecentAuth({ amr: [amr('password', -30)] }, false, NOW).ok, true);
  assertEquals(checkRecentAuth({ amr: [amr('password', -600)] }, false, NOW).ok, false);
});

Deno.test('recentAuth: malformed amr is treated as no proof', () => {
  for (const bad of [undefined, null, 'password', [{}], [{ method: 'password' }], [{ method: 'password', timestamp: '1' }]]) {
    assertEquals(checkRecentAuth({ amr: bad }, false, NOW).ok, false);
  }
});

Deno.test('decodeJwtPayload: decodes base64url payloads and rejects junk', () => {
  const payload = { aal: 'aal2', amr: [{ method: 'totp', timestamp: 1 }], email: 'ä@example.com' };
  const b64url = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assertEquals(decodeJwtPayload(`h.${b64url}.s`), payload);
  assertEquals(decodeJwtPayload('not-a-jwt'), null);
  assertEquals(decodeJwtPayload('a.%%%.c'), null);
});

const req = (xff: string | null) => new Request('https://x', { headers: xff === null ? {} : { 'x-forwarded-for': xff } });

Deno.test('clientIp: first forwarded address, validated', () => {
  assertEquals(clientIp(req('203.0.113.9, 10.0.0.1')), '203.0.113.9');
  assertEquals(clientIp(req('2001:db8::1')), '2001:db8::1');
  assertEquals(clientIp(req(null)), null);
  assertEquals(clientIp(req('unknown')), null);
  assertEquals(clientIp(req('999.1.1.1')), null);
  assertEquals(clientIp(req("1.2.3.4'; drop table x;--")), null);
});

Deno.test('recordSecurityEvent: maps fields to the RPC and reports success', async () => {
  let call: [string, Record<string, unknown>] | null = null;
  const ok = await recordSecurityEvent(
    { rpc: (fn, args) => { call = [fn, args]; return Promise.resolve({ error: null }); } },
    { type: 'admin.invited', actorId: 'u1', ip: '1.2.3.4', detail: { invited_email: 'a@b.c' } },
  );
  assertEquals(ok, true);
  assertEquals(call, ['record_security_event', {
    p_event_type: 'admin.invited', p_actor_id: 'u1', p_actor_email: null, p_ip: '1.2.3.4',
    p_target_id: null, p_detail: { invited_email: 'a@b.c' },
  }]);
});

Deno.test('recordSecurityEvent: never throws; returns false on an RPC error or a thrown error', async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    assertEquals(await recordSecurityEvent({ rpc: () => Promise.resolve({ error: { message: 'nope' } }) }, { type: 'a.b' }), false);
    assertEquals(await recordSecurityEvent({ rpc: () => Promise.reject(new Error('down')) }, { type: 'a.b' }), false);
  } finally {
    console.error = quiet;
  }
});
