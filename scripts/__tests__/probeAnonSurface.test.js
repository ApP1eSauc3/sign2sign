const { probes, run } = require('../probe-anon-surface');

const BASE = 'https://ref.supabase.co';

function response(status, body, headers = {}) {
  return {
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    headers: new Map(Object.entries(headers)),
  };
}

// What a correctly locked-down project answers, per migrations 006–014.
function hardened(url, init = {}) {
  const method = init.method || 'GET';
  if (url.includes('/rest/v1/')) return response(401, { code: '42501', message: 'permission denied' });
  if (url.includes('/storage/v1/object/list/')) return response(200, []);
  if (url.includes('/storage/v1/object/public/')) return response(400, { error: 'Bucket not found' });
  if (url.endsWith('/auth/v1/settings')) return response(200, { disable_signup: true });
  if (url.includes('/functions/v1/') && method === 'OPTIONS') return response(204, undefined, {});
  if (url.includes('/functions/v1/')) return response(401, { msg: 'missing authorization' });
  throw new Error(`unexpected ${method} ${url}`);
}

describe('probe-anon-surface', () => {
  it('passes every probe against a hardened project', async () => {
    const results = await run(BASE, 'anon', async (...a) => hardened(...a));
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results).toHaveLength(probes(BASE, 'anon').length);
  });

  it('fails when anon can read jobs', async () => {
    const leaky = async (url, init) =>
      url.includes('/rest/v1/jobs?select') ? response(200, [{ id: 'x' }]) : hardened(url, init);
    const failed = (await run(BASE, 'anon', leaky)).filter((r) => !r.ok);
    expect(failed.map((r) => r.name)).toEqual(['anon cannot SELECT jobs']);
  });

  it('fails when the photo bucket lists objects', async () => {
    const leaky = async (url, init) =>
      url.includes('/object/list/') ? response(200, [{ name: 'jobs/1/1.jpg' }]) : hardened(url, init);
    const failed = (await run(BASE, 'anon', leaky)).filter((r) => !r.ok);
    expect(failed).toEqual([expect.objectContaining({ name: 'anon cannot list job-photos (009)', reason: 'listing returned 1 objects' })]);
  });

  it('fails when a foreign origin is allowed by CORS', async () => {
    const leaky = async (url, init) =>
      init && init.method === 'OPTIONS'
        ? response(204, undefined, { 'Access-Control-Allow-Origin': '*' })
        : hardened(url, init);
    const failed = (await run(BASE, 'anon', leaky)).filter((r) => !r.ok);
    expect(failed.map((r) => r.reason)).toEqual(['Access-Control-Allow-Origin: *']);
  });

  it('fails when sign-up is enabled', async () => {
    const leaky = async (url, init) =>
      url.endsWith('/auth/v1/settings') ? response(200, { disable_signup: false }) : hardened(url, init);
    const failed = (await run(BASE, 'anon', leaky)).filter((r) => !r.ok);
    expect(failed.map((r) => r.name)).toEqual(['public sign-up is disabled']);
  });

  it('names an undeployed invite-admin instead of a vague failure', async () => {
    const undeployed = async (url, init) =>
      url.endsWith('/invite-admin') ? response(404, { message: 'not found' }) : hardened(url, init);
    const failed = (await run(BASE, 'anon', undeployed)).filter((r) => !r.ok);
    expect(failed.map((r) => r.reason)).toEqual(['NOT DEPLOYED (404) — runbook step 2']);
  });

  it('treats a network error as a failure, never a pass', async () => {
    const results = await run(BASE, 'anon', async () => { throw new Error('ECONNRESET'); });
    expect(results.every((r) => !r.ok && r.reason === 'request failed: ECONNRESET')).toBe(true);
  });

  it('never sends a sign-up request (it would create a user if sign-up were open)', () => {
    const urls = probes(BASE, 'anon').map((p) => p.req[0]);
    expect(urls.some((u) => u.includes('/auth/v1/signup'))).toBe(false);
  });

  it('only writes to the all-zero UUID, which cannot exist', () => {
    const writes = probes(BASE, 'anon').filter((p) => ['PATCH', 'PUT', 'DELETE'].includes(p.req[1].method));
    expect(writes.map((p) => p.req[0])).toEqual([`${BASE}/rest/v1/jobs?id=eq.00000000-0000-0000-0000-000000000000`]);
  });
});
