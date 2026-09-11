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

// Supabase personal access tokens are `sbp_` + hex. They are NOT JWTs, and
// they are NOT the project's anon/service_role keys — passing one of those
// gets a bare `401 {"message":"JWT could not be decoded"}` from the API, which
// says nothing about what went wrong. Every failure mode below is one someone
// actually hits, so each gets its own message.
function describeBadToken(token) {
  if (/[…]/.test(token)) {
    return 'It contains "…" — that is the placeholder from the docs, not a token.\n' +
           '  Copy the real value from https://supabase.com/dashboard/account/tokens';
  }
  if (/^["\']|["\']$/.test(token)) {
    return 'It is wrapped in quotes. Use: export SUPABASE_ACCESS_TOKEN=sbp_xxx  (no quotes)';
  }
  if (/\s/.test(token)) {
    return 'It contains whitespace or a newline — likely a copy-paste artifact.';
  }
  if (token.startsWith('eyJ') || (token.match(/\./g) || []).length === 2) {
    return 'That is a JWT — one of the project API keys (anon or service_role).\n' +
           '  Those authenticate to the PROJECT. The Management API needs an\n' +
           '  ACCOUNT-level personal access token, which starts with "sbp_".';
  }
  if (token.startsWith('sb_publishable_') || token.startsWith('sb_secret_')) {
    return 'That is a project API key, not an account token. You need an "sbp_" token.';
  }
  if (!token.startsWith('sbp_')) {
    return `It does not start with "sbp_" (starts with "${token.slice(0, 4)}…").`;
  }
  return `It starts with "sbp_" but is ${token.length} characters, which is shorter than expected.`;
}

// Falls back to the token `supabase login` stored in the macOS keychain, so
// the common case needs no export at all. Read at runtime on the user's own
// machine; the value is never printed or written anywhere.
function tokenFromKeychain() {
  if (process.platform !== 'darwin') return null;
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    return out || null;
  } catch {
    return null;  // no entry, or the user declined the keychain prompt
  }
}

function getAccessToken() {
  let token = process.env.SUPABASE_ACCESS_TOKEN;
  let source = 'SUPABASE_ACCESS_TOKEN';

  if (!token) {
    token = tokenFromKeychain();
    source = 'the macOS keychain (stored by `supabase login`)';
  }

  if (!token) {
    fail(
      'No Supabase access token found.\n\n' +
      '  Either run:   supabase login\n' +
      '  or create one at https://supabase.com/dashboard/account/tokens and:\n' +
      '    export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxx\n\n' +
      '  This is an ACCOUNT-scoped credential, not a project API key.\n' +
      '  Do not commit it or paste it into a file in this repo.'
    );
  }

  token = token.trim();
  if (!/^sbp_[A-Za-z0-9]{32,}$/.test(token)) {
    fail(
      `The token from ${source} is not a valid personal access token.\n\n` +
      `  ${describeBadToken(token)}\n\n` +
      '  A valid one looks like: sbp_ followed by ~40 hex characters.\n' +
      '  Get one at https://supabase.com/dashboard/account/tokens'
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
