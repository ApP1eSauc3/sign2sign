#!/usr/bin/env node
// Probes what the PUBLIC anon key can reach on the live project, and fails if
// anything answers that the migrations say must not.
//
// The anon key ships in every copy of the app, so this is exactly what an
// attacker can do. Each probe is read-only or targets a row that cannot exist
// (the all-zero UUID), and none creates data: sign-up is checked through the
// public /auth/v1/settings endpoint, never by attempting a sign-up.
//
// Expectations come from migrations 006–014 and src/services/CLAUDE.md → "RLS
// — what the anon key can and cannot do". If one fails, the grant or policy
// drifted in prod; that is the finding, not the script.
//
//   npm run security:probe            # reads EXPO_PUBLIC_SUPABASE_URL/ANON_KEY
//                                     # from the environment or .env.local
// Prints only status codes and Postgres error codes, never the key or data.
'use strict';

const fs = require('fs');
const path = require('path');

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function loadEnv() {
  const env = { ...process.env };
  const file = path.join(__dirname, '..', '.env.local');
  if ((!env.EXPO_PUBLIC_SUPABASE_URL || !env.EXPO_PUBLIC_SUPABASE_ANON_KEY) && fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*(EXPO_PUBLIC_SUPABASE_(?:URL|ANON_KEY))\s*=\s*(.*?)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

// Postgres "insufficient_privilege". PostgREST returns it in the JSON body.
const denied = (r) => r.body && r.body.code === '42501';

// Each probe: what to send, and a judge that returns null on pass or a
// short reason on fail. Judges see { status, body, headers } only.
function probes(base, key) {
  const anon = { apikey: key, Authorization: `Bearer ${key}` };
  const json = { ...anon, 'Content-Type': 'application/json' };
  return [
    {
      name: 'anon cannot SELECT jobs',
      req: [`${base}/rest/v1/jobs?select=id&limit=1`, { headers: anon }],
      judge: (r) => (denied(r) ? null : `expected 42501, got ${r.status} ${r.body && r.body.code}`),
    },
    {
      name: 'anon cannot read route_codes.code',
      req: [`${base}/rest/v1/route_codes?select=code&limit=1`, { headers: anon }],
      judge: (r) => (denied(r) ? null : `expected 42501, got ${r.status} ${r.body && r.body.code}`),
    },
    {
      name: 'anon cannot read code_attempts',
      req: [`${base}/rest/v1/code_attempts?select=client_id&limit=1`, { headers: anon }],
      judge: (r) => (denied(r) ? null : `expected 42501, got ${r.status} ${r.body && r.body.code}`),
    },
    {
      name: 'anon cannot call validate_route_code directly (008/010)',
      req: [`${base}/rest/v1/rpc/validate_route_code`, {
        method: 'POST', headers: json, body: JSON.stringify({ p_code: '000000', p_client_id: ZERO_UUID }),
      }],
      judge: (r) => (denied(r) ? null : `expected 42501, got ${r.status} ${r.body && r.body.code}`),
    },
    {
      name: 'anon cannot UPDATE jobs (013)',
      req: [`${base}/rest/v1/jobs?id=eq.${ZERO_UUID}`, {
        method: 'PATCH', headers: { ...json, Prefer: 'return=minimal' }, body: JSON.stringify({ photo_key: 'probe' }),
      }],
      judge: (r) => (denied(r) ? null : `expected 42501, got ${r.status} ${r.body && r.body.code}`),
    },
    {
      name: 'anon cannot list job-photos (009)',
      req: [`${base}/storage/v1/object/list/job-photos`, {
        method: 'POST', headers: json, body: JSON.stringify({ prefix: '', limit: 5 }),
      }],
      judge: (r) => {
        if (r.status >= 400) return null;
        if (Array.isArray(r.body) && r.body.length === 0) return null;
        return `listing returned ${Array.isArray(r.body) ? r.body.length + ' objects' : 'status ' + r.status}`;
      },
    },
    {
      name: 'job-photos is not a public bucket (009)',
      req: [`${base}/storage/v1/object/public/job-photos/jobs/${ZERO_UUID}/0.jpg`, {}],
      judge: (r) => (r.status === 400 || r.status === 404 ? null : `expected 400/404, got ${r.status}`),
    },
    {
      name: 'public sign-up is disabled',
      req: [`${base}/auth/v1/settings`, { headers: { apikey: key } }],
      judge: (r) => (r.body && r.body.disable_signup === true ? null : `disable_signup is ${r.body && r.body.disable_signup}`),
    },
    {
      name: 'delete-admin-account rejects an anonymous caller',
      req: [`${base}/functions/v1/delete-admin-account`, { method: 'POST', headers: json, body: '{}' }],
      judge: (r) => (r.status === 401 ? null : `expected 401, got ${r.status}`),
    },
    {
      name: 'delete-admin-account does not allow a foreign origin (CORS)',
      req: [`${base}/functions/v1/delete-admin-account`, {
        method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
      }],
      judge: (r) => {
        const allowed = r.headers['access-control-allow-origin'];
        return !allowed ? null : `Access-Control-Allow-Origin: ${allowed}`;
      },
    },
    {
      name: 'invite-admin rejects an anonymous caller',
      req: [`${base}/functions/v1/invite-admin`, { method: 'POST', headers: json, body: '{}' }],
      judge: (r) => {
        if (r.status === 401) return null;
        if (r.status === 404) return 'NOT DEPLOYED (404) — runbook step 2';
        return `expected 401, got ${r.status}`;
      },
    },
  ];
}

async function run(base, key, fetchImpl = fetch) {
  const results = [];
  for (const p of probes(base, key)) {
    let verdict;
    try {
      const res = await fetchImpl(...p.req);
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      const headers = {};
      res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
      verdict = p.judge({ status: res.status, body, headers });
    } catch (e) {
      verdict = `request failed: ${e.message}`;
    }
    results.push({ name: p.name, ok: verdict === null, reason: verdict });
  }
  return results;
}

async function main() {
  const env = loadEnv();
  const base = (env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) {
    console.error('✗ Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (or keep them in .env.local).');
    process.exit(1);
  }
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\nAnon-surface probe — ${new URL(base).host.split('.')[0].slice(0, 4)}… — ${today}\n`);
  const results = await run(base, key);
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `\n    ${r.reason}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n✗ ${failed} of ${results.length} probes failed.` : `\n✓ All ${results.length} probes passed.`);
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();
module.exports = { probes, run };
