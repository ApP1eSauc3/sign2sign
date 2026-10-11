#!/usr/bin/env node
// Applies supabase/auth-templates/*.html to the project's Auth config.
//
// This is the step that makes the password-reset and admin-invite flows work
// at all: the stock Supabase templates carry only {{ .ConfirmationURL }}, and
// the app reads the numeric {{ .Token }} instead.
//
//   export SUPABASE_ACCESS_TOKEN=sbp_…
//   node scripts/auth-config-audit.js            # read + back up first
//   node scripts/apply-auth-templates.js --dry-run
//   node scripts/apply-auth-templates.js
//
// ⚠️ WRITES TO PRODUCTION AUTH CONFIG. Run the audit first — it backs up the
//    live templates into supabase/auth-templates/backup/.
'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, authConfigRequest, getProjectRef, fail } = require('./authConfig');

const TEMPLATE_DIR = path.join(REPO_ROOT, 'supabase', 'auth-templates');

const TEMPLATES = [
  {
    file: 'recovery.html',
    contentField: 'mailer_templates_recovery_content',
    subjectField: 'mailer_subjects_recovery',
    subject: 'Your Sign2Sign password reset code',
  },
  {
    file: 'invite.html',
    contentField: 'mailer_templates_invite_content',
    subjectField: 'mailer_subjects_invite',
    subject: 'You have been invited to Sign2Sign',
  },
];

function loadTemplate({ file }) {
  const full = path.join(TEMPLATE_DIR, file);
  if (!fs.existsSync(full)) fail(`Missing template: ${full}`);
  const content = fs.readFileSync(full, 'utf8');

  // The whole point of the change. A template without the token ships an
  // email the app cannot act on, and nothing downstream would catch it —
  // no test, no typecheck, no deploy error. Refuse here instead.
  if (!content.includes('{{ .Token }}')) {
    fail(`${file} does not contain {{ .Token }}. Both app flows would break silently.`);
  }
  // A non-empty read, asserted rather than assumed — this repo has had a
  // verification give a false pass on empty input before.
  if (content.trim().length < 200) fail(`${file} looks empty or truncated (${content.length} bytes).`);
  return content;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const ref = getProjectRef();

  const body = {};
  console.log(`\nTemplates to apply to project ${ref.slice(0, 4)}…${ref.slice(-4)}:\n`);
  for (const t of TEMPLATES) {
    const content = loadTemplate(t);
    body[t.contentField] = content;
    body[t.subjectField] = t.subject;
    console.log(`  ${t.file.padEnd(14)} ${String(content.length).padStart(5)} bytes → ${t.contentField}`);
    console.log(`  ${''.padEnd(14)} subject: "${t.subject}"`);
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing was sent.\n');
    return;
  }

  const backupDir = path.join(TEMPLATE_DIR, 'backup');
  if (!fs.existsSync(backupDir)) {
    fail(
      'No backup found in supabase/auth-templates/backup/.\n' +
      '  Run `node scripts/auth-config-audit.js` first — it records what is live\n' +
      '  now, so this is reversible.'
    );
  }

  await authConfigRequest('PATCH', body);
  console.log('\n✓ Applied. Verify with:  node scripts/auth-config-audit.js');
  console.log('  Then send a real invite to a mailbox you control before trusting it.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
