// Pure decision logic for scripts/audit-gate.js. Kept separate so it can be
// unit-tested without running npm (scripts/__tests__/auditGate.test.js).
'use strict';

const GATED_SEVERITIES = new Set(['high', 'critical']);

// npm audit --json (v7+ format) lists vulnerable *packages*; the advisories
// themselves sit in each package's `via` array as objects. Entries in `via`
// that are plain strings only say "vulnerable because of that other package",
// so they are skipped: the advisory is counted once, under the package that
// actually has it.
function collectAdvisories(auditJson) {
  const byId = new Map();
  for (const pkg of Object.values(auditJson.vulnerabilities || {})) {
    for (const via of pkg.via || []) {
      if (typeof via !== 'object' || via === null) continue;
      if (!GATED_SEVERITIES.has(via.severity)) continue;
      const id = String(via.url || '').split('/').pop();
      if (!id) continue;
      if (!byId.has(id)) {
        byId.set(id, { id, package: via.name, severity: via.severity, title: via.title, range: via.range });
      }
    }
  }
  return [...byId.values()];
}

// Returns what the gate should report. `today` is an ISO date (YYYY-MM-DD).
//   blocking — high/critical advisories nobody has triaged
//   expired  — allowlist entries past their reviewBy date (re-triage them)
//   stale    — allowlist entries npm no longer reports (delete them)
//   accepted — allowlisted and still current
function evaluate(auditJson, allowlist, today) {
  const advisories = collectAdvisories(auditJson);
  const allowed = new Map(allowlist.map((entry) => [entry.id, entry]));
  const reported = new Set(advisories.map((a) => a.id));

  const blocking = [];
  const expired = [];
  const accepted = [];
  for (const advisory of advisories) {
    const entry = allowed.get(advisory.id);
    if (!entry) blocking.push(advisory);
    else if (entry.reviewBy < today) expired.push({ ...advisory, reviewBy: entry.reviewBy });
    else accepted.push(advisory);
  }
  const stale = allowlist.filter((entry) => !reported.has(entry.id));
  return { blocking, expired, stale, accepted, ok: blocking.length === 0 && expired.length === 0 };
}

// Every allowlist entry must say what it is, why it is safe, and when to look
// again. An entry without a reason is how an allowlist becomes a mute button.
function validateAllowlist(allowlist) {
  const problems = [];
  if (!Array.isArray(allowlist)) return ['allowlist must be a JSON array'];
  allowlist.forEach((entry, i) => {
    for (const field of ['id', 'package', 'reason', 'reviewBy']) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
        problems.push(`entry ${i} is missing "${field}"`);
      }
    }
    if (typeof entry.reviewBy === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewBy)) {
      problems.push(`entry ${i} reviewBy must be YYYY-MM-DD`);
    }
  });
  return problems;
}

module.exports = { collectAdvisories, evaluate, validateAllowlist };
