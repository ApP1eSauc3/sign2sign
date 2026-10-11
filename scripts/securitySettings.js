// Pure planning logic for scripts/apply-security-settings.js, kept separate so
// it is unit-tested (scripts/__tests__/securitySettings.test.js).
'use strict';

const HOOK_URI = 'pg-functions://postgres/public/custom_access_token_hook';

// NIST SP 800-63B-4 §2 (pages.nist.gov/800-63-4/sp800-63b/aal, read 2026-10-11):
//   AAL1: overall timeout SHALL exist, SHOULD be ≤ 30 days; inactivity optional.
//   AAL2: overall ≤ 24 hours, inactivity ≤ 1 hour (both SHOULD).
// Two-step sign-in is optional here, so most admin sessions are AAL1. The
// defaults take the AAL1 ceiling for the overall limit and add a one-day
// inactivity limit: an office dashboard used daily stays signed in, a lost
// laptop or phone does not. Tighten with the flags if the client wants AAL2's.
const DEFAULT_TIMEBOX_HOURS = 720;      // 30 days
const DEFAULT_INACTIVITY_HOURS = 24;
const MAX_HOURS = 8760;                 // Management API limit (1 year)

function readNumberFlag(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return { value: fallback };
  const raw = argv[i + 1];
  const value = Number(raw);
  if (raw === undefined || !Number.isFinite(value) || value < 0 || value > MAX_HOURS) {
    return { error: `${name} needs a number of hours from 0 to ${MAX_HOURS} (got "${raw}").` };
  }
  return { value };
}

// Returns { body, dryRun, enableHook } or { error }.
function planSecuritySettings(argv) {
  const timebox = readNumberFlag(argv, '--timebox-hours', DEFAULT_TIMEBOX_HOURS);
  if (timebox.error) return { error: timebox.error };
  const inactivity = readNumberFlag(argv, '--inactivity-hours', DEFAULT_INACTIVITY_HOURS);
  if (inactivity.error) return { error: inactivity.error };
  if (timebox.value > 0 && inactivity.value > timebox.value) {
    return { error: 'The inactivity limit cannot be longer than the overall limit.' };
  }

  const enableHook = !argv.includes('--skip-hook');
  const body = {
    sessions_timebox: timebox.value,
    sessions_inactivity_timeout: inactivity.value,
  };
  if (enableHook) {
    body.hook_custom_access_token_enabled = true;
    body.hook_custom_access_token_uri = HOOK_URI;
  }
  return { body, dryRun: argv.includes('--dry-run'), enableHook };
}

// The read-only query result says whether migration 016's hook function
// exists. Enabling the hook without it would make every sign-in fail.
function hookFunctionPresent(rows) {
  return Array.isArray(rows) && rows.length === 1 && rows[0] && rows[0].present === true;
}

const HOOK_CHECK_SQL =
  "select to_regprocedure('public.custom_access_token_hook(jsonb)') is not null as present";

module.exports = {
  planSecuritySettings,
  hookFunctionPresent,
  HOOK_CHECK_SQL,
  HOOK_URI,
  DEFAULT_TIMEBOX_HOURS,
  DEFAULT_INACTIVITY_HOURS,
};
