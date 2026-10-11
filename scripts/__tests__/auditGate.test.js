const { collectAdvisories, evaluate, validateAllowlist } = require('../auditGate');

// Shaped like real `npm audit --json` (npm 7+): the advisory object sits in the
// `via` of the package that has it; dependents carry a plain string instead.
function report(...advisories) {
  const vulnerabilities = {};
  for (const a of advisories) {
    vulnerabilities[a.name] = {
      name: a.name,
      severity: a.severity,
      via: [{ name: a.name, severity: a.severity, title: a.title || 't', range: '<9', url: `https://github.com/advisories/${a.id}` }],
    };
    vulnerabilities[`${a.name}-dependent`] = { name: `${a.name}-dependent`, severity: a.severity, via: [a.name] };
  }
  return { vulnerabilities };
}

const entry = (id, reviewBy = '2027-01-01') => ({ id, package: 'p', reason: 'r', reviewBy });

describe('collectAdvisories', () => {
  it('counts an advisory once, under the package that has it, not its dependents', () => {
    const found = collectAdvisories(report({ id: 'GHSA-a', name: 'tar', severity: 'high' }));
    expect(found).toEqual([expect.objectContaining({ id: 'GHSA-a', package: 'tar', severity: 'high' })]);
  });

  it('ignores moderate and low', () => {
    const found = collectAdvisories(report(
      { id: 'GHSA-m', name: 'm', severity: 'moderate' },
      { id: 'GHSA-l', name: 'l', severity: 'low' },
    ));
    expect(found).toEqual([]);
  });

  it('copes with an empty report', () => {
    expect(collectAdvisories({})).toEqual([]);
  });
});

describe('evaluate', () => {
  const today = '2026-10-11';

  it('blocks an untriaged high advisory', () => {
    const result = evaluate(report({ id: 'GHSA-new', name: 'x', severity: 'critical' }), [], today);
    expect(result.ok).toBe(false);
    expect(result.blocking.map((a) => a.id)).toEqual(['GHSA-new']);
  });

  it('passes an allowlisted advisory whose review date is today or later', () => {
    const result = evaluate(report({ id: 'GHSA-ok', name: 'x', severity: 'high' }), [entry('GHSA-ok', today)], today);
    expect(result.ok).toBe(true);
    expect(result.accepted.map((a) => a.id)).toEqual(['GHSA-ok']);
  });

  // The point of reviewBy: an allowlist entry must not become permanent.
  it('fails once an entry is past its review date', () => {
    const result = evaluate(report({ id: 'GHSA-old', name: 'x', severity: 'high' }), [entry('GHSA-old', '2026-10-10')], today);
    expect(result.ok).toBe(false);
    expect(result.expired.map((a) => a.id)).toEqual(['GHSA-old']);
  });

  it('reports entries npm no longer lists as stale, without failing', () => {
    const result = evaluate(report(), [entry('GHSA-gone')], today);
    expect(result.ok).toBe(true);
    expect(result.stale.map((e) => e.id)).toEqual(['GHSA-gone']);
  });

  it('allowlisting one advisory does not excuse a different one in the same package', () => {
    const result = evaluate(report(
      { id: 'GHSA-1', name: 'tar', severity: 'high' },
    ), [entry('GHSA-2')], today);
    expect(result.blocking.map((a) => a.id)).toEqual(['GHSA-1']);
  });
});

describe('validateAllowlist', () => {
  it('accepts a complete entry', () => {
    expect(validateAllowlist([entry('GHSA-x')])).toEqual([]);
  });

  it('rejects an entry with no reason', () => {
    expect(validateAllowlist([{ id: 'GHSA-x', package: 'p', reason: ' ', reviewBy: '2027-01-01' }]))
      .toEqual(['entry 0 is missing "reason"']);
  });

  it('rejects a review date that is not YYYY-MM-DD', () => {
    expect(validateAllowlist([entry('GHSA-x', '11/01/2027')])).toEqual(['entry 0 reviewBy must be YYYY-MM-DD']);
  });

  it('rejects a non-array file', () => {
    expect(validateAllowlist({})).toEqual(['allowlist must be a JSON array']);
  });

  it('the committed allowlist is valid', () => {
    expect(validateAllowlist(require('../audit-allowlist.json'))).toEqual([]);
  });
});
