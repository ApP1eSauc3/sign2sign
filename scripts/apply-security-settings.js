#!/usr/bin/env node
// Applies the Auth settings that pair with the 2026-10-11 security fixes:
//
//   * Session limits (S-1 in docs/SECURITY_CHECKLIST_CROSSCHECK_2026_10_11.md):
//     an overall limit and an inactivity limit for admin sessions. Both are
//     Supabase Pro features; on Free the PATCH is refused.
//   * The custom access-token hook from migration 016, which writes each new
//     admin session to public.security_events.
//
//   npm run auth:apply-security -- --dry-run
//   npm run auth:apply-security
//   npm run auth:apply-security -- --inactivity-hours 8 --timebox-hours 168
//   npm run auth:apply-security -- --skip-hook     # session limits only
//
// Order matters: run `supabase db push` (migration 016) FIRST. This script
// checks that the hook function exists before switching the hook on, because
// a hook pointing at a missing function fails every sign-in.
//
// Rollback: set the hook off and the limits to 0 in Authentication settings,
// or re-run with --timebox-hours 0 --inactivity-hours 0 --skip-hook and turn
// the hook off in the dashboard.
//
// ⚠️ WRITES TO PRODUCTION AUTH CONFIG.
'use strict';

const { authConfigRequest, readOnlyQuery, getProjectRef, fail } = require('./authConfig');
const { planSecuritySettings, hookFunctionPresent, HOOK_CHECK_SQL } = require('./securitySettings');

async function main() {
  const plan = planSecuritySettings(process.argv.slice(2));
  if (plan.error) fail(plan.error);

  console.log(`\nAuth security settings for project ${getProjectRef().slice(0, 4)}…:\n`);
  for (const [k, v] of Object.entries(plan.body)) console.log(`  ${k.padEnd(34)} ${v}`);

  if (plan.enableHook) {
    const rows = await readOnlyQuery(HOOK_CHECK_SQL);
    if (!hookFunctionPresent(rows)) {
      fail(
        'public.custom_access_token_hook(jsonb) does not exist in the database.\n' +
        '  Apply migration 016 first (supabase db push), or pass --skip-hook.\n' +
        '  Enabling the hook without the function would fail every sign-in.'
      );
    }
    console.log('\n  ✓ migration 016 hook function found');
  }

  if (plan.dryRun) {
    console.log('\n--dry-run: nothing was sent.\n');
    return;
  }

  await authConfigRequest('PATCH', plan.body);

  // Re-read rather than trusting the 200.
  const after = await authConfigRequest('GET');
  const mismatches = Object.entries(plan.body).filter(([k, v]) => after[k] !== v);
  if (mismatches.length) {
    console.log('\n✗ PATCH returned 200 but these did not take:');
    for (const [k, v] of mismatches) console.log(`    ${k}: wanted ${v}, now ${after[k]}`);
    console.log('  Session limits need the Pro plan — check the project is on it.\n');
    process.exit(1);
  }
  console.log('\n✓ Applied and verified.\n');
  console.log('  Now sign in to the admin app once, then in the SQL editor run:');
  console.log("    select event_type, actor_email, occurred_at from public.security_events order by id desc limit 5;");
  console.log('  An auth.password row from your sign-in proves the hook is live.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
