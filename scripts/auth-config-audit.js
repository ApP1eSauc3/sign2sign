#!/usr/bin/env node
// Read-only audit of the project's Supabase Auth config.
//
// Exists because open-work #5 records three settings as "unverified" on the
// grounds that they are "unreadable from a terminal". They are readable: the
// Management API GET on /config/auth returns all of them. This prints each
// with today's date so the value can be recorded as measured, not assumed
// (CLAUDE.md Documentation Integrity Rule 2 — a claim needs a date and a
// method).
//
// It also backs up the two live email templates before anyone overwrites them
// with scripts/apply-auth-templates.js.
//
// Writes nothing to the project. Safe to run any time.
//
//   export SUPABASE_ACCESS_TOKEN=sbp_…
//   node scripts/auth-config-audit.js
'use strict';

const fs = require('fs');
const path = require('path');
const { AUDIT_FIELDS, REPO_ROOT, authConfigRequest, getProjectRef } = require('./authConfig');

const TEMPLATE_FIELDS = [
  ['mailer_templates_recovery_content', 'recovery'],
  ['mailer_templates_invite_content', 'invite'],
];

function describe(key, value) {
  if (value === undefined) return '(not returned by the API)';
  if (key === 'mailer_otp_exp') {
    const mins = Math.round(Number(value) / 60);
    // Supabase's own guidance is to keep this under an hour.
    const flag = Number(value) > 3600 ? '  ⚠️ longer than 1 hour' : '';
    return `${value}s (${mins} min)${flag}`;
  }
  return String(value);
}

async function main() {
  const ref = getProjectRef();
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\nSupabase Auth config — project ${ref.slice(0, 4)}…${ref.slice(-4)} — read ${today}\n`);

  const config = await authConfigRequest('GET');

  let widest = 0;
  for (const key of AUDIT_FIELDS) widest = Math.max(widest, key.length);
  for (const key of AUDIT_FIELDS) {
    console.log(`  ${key.padEnd(widest)}  ${describe(key, config[key])}`);
  }

  // Without custom SMTP, GoTrue only delivers to members of the Supabase org,
  // so a reset or invite to anyone else "succeeds" and never arrives (#32).
  console.log(
    config.smtp_host
      ? `\n✓ Custom SMTP is configured (${config.smtp_host}).`
      : '\n✗ No custom SMTP. Auth emails reach Supabase org members only (open-work #32).'
  );

  // Back up whatever is live before apply-auth-templates.js can replace it.
  //
  // Timestamped to the SECOND, and never overwritten. The first version of
  // this used a date-only name, so running the audit again after applying new
  // templates silently replaced the only copy of the originals with the new
  // content — a backup a later run can clobber is not a backup. Found the day
  // it was written, by re-running the audit to verify an apply.
  const backupDir = path.join(REPO_ROOT, 'supabase', 'auth-templates', 'backup');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  console.log('\nLive email templates backed up to supabase/auth-templates/backup/:');
  for (const [field, name] of TEMPLATE_FIELDS) {
    const content = config[field] ?? '';
    const file = path.join(backupDir, `${name}.${stamp}.html`);
    // wx: fail rather than overwrite. Two runs inside one second are the only
    // way to collide, and losing that duplicate costs nothing.
    try {
      fs.writeFileSync(file, content, { flag: 'wx' });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const hasToken = content.includes('{{ .Token }}');
    console.log(
      `  ${name.padEnd(9)} ${String(content.length).padStart(5)} bytes  ` +
      `{{ .Token }}: ${hasToken ? 'present ✓' : 'ABSENT ✗ — both app flows are inert'}`
    );
  }

  const ready = TEMPLATE_FIELDS.every(([f]) => (config[f] ?? '').includes('{{ .Token }}'));
  console.log(
    ready
      ? '\n✓ Both templates carry {{ .Token }} — the app flows can work.\n'
      : '\n✗ At least one template has no {{ .Token }}. Run:\n' +
        '    node scripts/apply-auth-templates.js --dry-run\n'
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
