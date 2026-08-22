import { orderJobsForDisplay } from '../mapOrder.logic';
import { SignJob } from '../../../data/SignJob';

function job(id: string, sortOrder: number, over: Partial<SignJob> = {}): SignJob {
  return {
    id,
    clientName: 'Harcourts',
    agentName: 'Jane',
    agentEmail: '',
    address: `${sortOrder} Maple St`,
    signDescription: 'Corflute',
    jobType: 'install',
    latitude: -31.95,
    longitude: 115.86,
    sortOrder,
    isComplete: false,
    ...over,
  };
}

describe('orderJobsForDisplay — no optimized order yet', () => {
  it('falls back to sheet order', () => {
    const jobs = [job('c', 3), job('a', 1), job('b', 2)];
    expect(orderJobsForDisplay(jobs, []).map((j) => j.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks a sort_order tie deterministically by id', () => {
    const jobs = [job('zz', 1), job('aa', 1), job('mm', 1)];
    expect(orderJobsForDisplay(jobs, []).map((j) => j.id)).toEqual(['aa', 'mm', 'zz']);
  });

  it('does not mutate the input array', () => {
    const jobs = [job('c', 3), job('a', 1)];
    const snapshot = jobs.map((j) => j.id);
    orderJobsForDisplay(jobs, []);
    expect(jobs.map((j) => j.id)).toEqual(snapshot);
  });

  it('handles an empty route', () => {
    expect(orderJobsForDisplay([], [])).toEqual([]);
  });
});

describe('orderJobsForDisplay — with an optimized order', () => {
  it('follows the optimized sequence, not sheet order', () => {
    const jobs = [job('a', 1), job('b', 2), job('c', 3)];
    expect(orderJobsForDisplay(jobs, ['c', 'a', 'b']).map((j) => j.id)).toEqual(['c', 'a', 'b']);
  });

  // The whole reason ids are resolved against `jobs` on every render rather
  // than the ordered list being cached as objects: pin state must stay live.
  it('returns the CURRENT job objects, not the ones captured at mount', () => {
    const jobs = [job('a', 1, { isComplete: true }), job('b', 2)];
    const [first] = orderJobsForDisplay(jobs, ['a', 'b']);

    expect(first.isComplete).toBe(true);
    expect(first).toBe(jobs[0]);   // same reference — memoisation downstream depends on it
  });

  // orderedJobIds is a snapshot taken at mount, so it can name a job that has
  // since left the session. A hole here used to reach the Marker and crash on
  // `job.id`.
  it('drops ids with no matching job instead of emitting holes', () => {
    const jobs = [job('a', 1), job('c', 3)];
    const result = orderJobsForDisplay(jobs, ['a', 'ghost', 'c']);

    expect(result.map((j) => j.id)).toEqual(['a', 'c']);
    expect(result.every((j) => j !== undefined)).toBe(true);
  });

  it('drops every id when none of them match', () => {
    expect(orderJobsForDisplay([job('a', 1)], ['x', 'y'])).toEqual([]);
  });

  // A job added to the session after the route was computed simply is not in
  // the optimized sequence. Showing it out of order would be worse than the
  // current behaviour of leaving it off the map until the route recomputes.
  it('ignores jobs absent from the optimized sequence', () => {
    const jobs = [job('a', 1), job('b', 2), job('late', 3)];
    expect(orderJobsForDisplay(jobs, ['b', 'a']).map((j) => j.id)).toEqual(['b', 'a']);
  });

  it('tolerates a duplicated id in the sequence without losing the rest', () => {
    const jobs = [job('a', 1), job('b', 2)];
    expect(orderJobsForDisplay(jobs, ['a', 'a', 'b']).map((j) => j.id)).toEqual(['a', 'a', 'b']);
  });

  // The point of the rewrite. A quadratic implementation on a large route is
  // slow enough to be measurable; this pins that it is not.
  it('stays linear on a large route', () => {
    const jobs = Array.from({ length: 5000 }, (_, i) => job(`job-${i}`, i));
    const ids = jobs.map((j) => j.id).reverse();

    const start = Date.now();
    const result = orderJobsForDisplay(jobs, ids);
    const elapsed = Date.now() - start;

    expect(result).toHaveLength(5000);
    expect(result[0].id).toBe('job-4999');
    // The nested-find version is ~12.5M comparisons here. Generous bound so the
    // test cannot flake on a loaded CI box, but far below quadratic cost.
    expect(elapsed).toBeLessThan(250);
  });
});
