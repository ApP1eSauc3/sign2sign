#!/usr/bin/env node
// Points the project's Auth emails at a real SMTP provider.
//
// WHY THIS MATTERS (open-work #32): with no custom SMTP, Supabase's built-in
// service "will refuse to deliver messages to addresses that are not part of
// the project's team" and caps at 2 messages/hour. That makes the admin-invite
// feature non-functional for the only thing it exists to do — inviting someone
// who is by definition not yet on the team — and it fails SILENTLY: the API
// returns success and no mail arrives.
//
// Credentials come from the environment and are never written to disk or
// echoed. The SMTP password is an API key; treat it like one.
//
//   export SMTP_HOST=smtp.resend.com
//   export SMTP_PORT=465
//   export SMTP_USER=resend
//   export SMTP_PASS=re_xxxxxxxx            # the provider's API key
//   export SMTP_ADMIN_EMAIL=noreply@sign2site.com.au
//   export SMTP_SENDER_NAME="Sign2Site"
//   node scripts/apply-smtp.js --dry-run
//   node scripts/apply-smtp.js
//
// ⚠️ WRITES TO PRODUCTION AUTH CONFIG.
'use strict';

const { authConfigRequest, getProjectRef, fail } = require('./authConfig');

// rate_limit_email_sent is 2/hour while the built-in service is in use. That
// ceiling exists to protect Supabase's shared SMTP, not you, so it is raised
// once your own provider is carrying the mail. Kept modest: this app sends
// only password resets and admin invites, and a low cap is a real brake on
// anyone who finds a way to trigger mail in a loop.
const DEFAULT_EMAIL_RATE_LIMIT = 30;

const REQUIRED = [
  ['SMTP_HOST', 'smtp_host'],
  ['SMTP_PORT', 'smtp_port'],
  ['SMTP_USER', 'smtp_user'],
  ['SMTP_PASS', 'smtp_pass'],
  ['SMTP_ADMIN_EMAIL', 'smtp_admin_email'],
  ['SMTP_SENDER_NAME', 'smtp_sender_name'],
];

function collect() {
  const body = {};
  const missing = [];
  for (const [envName, field] of REQUIRED) {
    const value = (process.env[envName] || '').trim();
    if (!value) { missing.push(envName); continue; }
    body[field] = field === 'smtp_port' ? Number(value) : value;
  }
  if (missing.length) {
    fail(
      `Missing required environment variables:\n    ${missing.join('\n    ')}\n\n` +
      '  See the header of this file for the full export block.'
    );
  }
  if (!Number.isInteger(body.smtp_port) || body.smtp_port < 1 || body.smtp_port > 65535) {
    fail(`SMTP_PORT must be a port number (got "${process.env.SMTP_PORT}").`);
  }
  // The sender address must be on a domain the provider has verified. Getting
  // this wrong is the single most common cause of "configured, still nothing
  // arrives" — the provider accepts the credentials and rejects every message.
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(body.smtp_admin_email)) {
    fail(`SMTP_ADMIN_EMAIL is not an email address (got "${body.smtp_admin_email}").`);
  }
  return body;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const body = collect();

  const rate = Number(process.env.EMAIL_RATE_LIMIT || DEFAULT_EMAIL_RATE_LIMIT);
  if (Number.isInteger(rate) && rate > 0) body.rate_limit_email_sent = rate;

  console.log(`\nSMTP settings for project ${getProjectRef().slice(0, 4)}…:\n`);
  for (const [k, v] of Object.entries(body)) {
    console.log(`  ${k.padEnd(22)} ${k === 'smtp_pass' ? `(${String(v).length} chars, not shown)` : v}`);
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing was sent.\n');
    return;
  }

  await authConfigRequest('PATCH', body);

  // Re-read rather than trusting the 200. smtp_pass is never returned, so the
  // host is the observable proof the write landed.
  const after = await authConfigRequest('GET');
  const ok = after.smtp_host === body.smtp_host && after.smtp_admin_email === body.smtp_admin_email;
  console.log(
    ok
      ? `\n✓ Applied and verified: smtp_host=${after.smtp_host}, sender=${after.smtp_admin_email}, ` +
        `rate_limit_email_sent=${after.rate_limit_email_sent}\n`
      : '\n✗ PATCH returned 200 but the re-read does not match. Check the dashboard.\n'
  );
  console.log('  Now send a real invite to an address OUTSIDE your Supabase org.');
  console.log('  Testing with your own address proves nothing — it is a team member.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
