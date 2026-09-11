// Shared helpers for the two auth-config scripts.
//
// Both talk to the Supabase Management API, which is NOT the same thing as the
// project's own anon/service keys: it is authenticated with a personal access
// token from https://supabase.com/dashboard/account/tokens and scoped to your
// Supabase account, not to one project. Never commit one, never echo one.
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const API_ROOT = 'https://api.supabase.com/v1';

// The three settings open-work #5 records as "unverified" because they were
// believed unreadable from a terminal. They are readable — this is the list.
const AUDIT_FIELDS = [
  'mailer_otp_exp',
  'rate_limit_email_sent',
  'rate_limit_verify',
  'rate_limit_token_refresh',
  'refresh_token_rotation_enabled',
  'security_refresh_token_reuse_interval',
  'disable_signup',
  'mailer_autoconfirm',
  'external_email_enabled',
];

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function getAccessToken() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    fail(
      'SUPABASE_ACCESS_TOKEN is not set.\n\n' +
      '  Create one at https://supabase.com/dashboard/account/tokens, then:\n' +
      '    export SUPABASE_ACCESS_TOKEN=sbp_…\n\n' +
      '  It is an account-scoped credential. Do not commit it and do not paste\n' +
      '  it into a file in this repo.'
    );
  }
  return token;
}

// The CLI writes the linked project ref here on `supabase link`. Reading it
// rather than asking for it means these scripts cannot be pointed at the
// wrong project by a typo.
function getProjectRef() {
  const refFile = path.join(REPO_ROOT, 'supabase', '.temp', 'project-ref');
  if (!fs.existsSync(refFile)) {
    fail(`No linked project found at supabase/.temp/project-ref.\n  Run: supabase link --project-ref <ref>`);
  }
  const ref = fs.readFileSync(refFile, 'utf8').trim();
  if (!/^[a-z]{20}$/.test(ref)) fail(`project-ref does not look like a project ref.`);
  return ref;
}

async function authConfigRequest(method, body) {
  const ref = getProjectRef();
  const response = await fetch(`${API_ROOT}/projects/${ref}/config/auth`, {
    method,
    headers: {
      'Authorization': `Bearer ${getAccessToken()}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  if (!response.ok) {
    // 401 here means the token is bad or expired, NOT that the project is
    // wrong — the ref is validated above.
    fail(`Management API ${method} failed: ${response.status}\n  ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`Management API returned a non-JSON body:\n  ${text.slice(0, 200)}`);
  }
}

module.exports = { AUDIT_FIELDS, REPO_ROOT, authConfigRequest, getProjectRef, fail };
