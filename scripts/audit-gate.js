#!/usr/bin/env node
// CI dependency gate: fails on any high/critical npm advisory that has not
// been triaged into scripts/audit-allowlist.json, or whose triage has expired.
//
// Replaces a bare `npm audit --audit-level=high`, which failed on every run
// because of build-tool advisories that never ship. A job that is always red
// stops being read, so a new advisory in shipped code would have gone
// unnoticed (docs/SECURITY_CHECKLIST_CROSSCHECK_2026_10_11.md, C-9).
//
// Scans the FULL tree, dev dependencies included: electron-builder and Expo's
// CLI run on the release machine next to the signing keys, so their supply
// chain matters even though they don't ship.
//
//   npm run audit:gate
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { evaluate, validateAllowlist } = require('./auditGate');

const ALLOWLIST = path.join(__dirname, 'audit-allowlist.json');

function main() {
  const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8'));
  const problems = validateAllowlist(allowlist);
  if (problems.length) {
    console.error('✗ audit-allowlist.json is invalid:\n  ' + problems.join('\n  '));
    process.exit(1);
  }

  // npm audit exits non-zero whenever anything is found, so read stdout and
  // decide ourselves. A missing or unparseable report is a failure, never a pass.
  const run = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    console.error('✗ Could not parse `npm audit --json` output:\n' + (run.stderr || run.stdout).slice(0, 2000));
    process.exit(1);
  }
  if (report.error) {
    console.error(`✗ npm audit failed: ${report.error.summary || JSON.stringify(report.error)}`);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const result = evaluate(report, allowlist, today);
  const line = (a) => `  ${a.severity.padEnd(8)} ${a.id}  ${a.package} ${a.range}\n           ${a.title}`;

  for (const a of result.accepted) console.log(`✓ triaged  ${a.id}  ${a.package}`);
  for (const e of result.stale) {
    console.log(`! stale    ${e.id}  ${e.package} is no longer reported. Delete it from audit-allowlist.json.`);
  }
  if (result.expired.length) {
    console.error('\n✗ Triage expired. Re-check these and move reviewBy forward, or fix them:');
    result.expired.forEach((a) => console.error(line(a) + `\n           reviewBy ${a.reviewBy}`));
  }
  if (result.blocking.length) {
    console.error('\n✗ Untriaged high/critical advisories:');
    result.blocking.forEach((a) => console.error(line(a)));
    console.error(
      '\nFix it (npm audit fix, an upgrade, or an override). Allowlist it only if it\n' +
      'cannot reach a user or the release machine, and write down why.'
    );
  }
  if (!result.ok) process.exit(1);
  console.log(`\n✓ No untriaged high/critical advisories (${result.accepted.length} triaged).`);
}

main();
