import { SignJob } from '../../data/SignJob';

// Pure ordering logic for the driver map's pins, extracted from
// DriverMapScreen so it can be tested without a renderer — the same pattern as
// advancingActionButton.logic.ts and statusBadge.logic.ts.
//
// Two sources have to be reconciled on every render:
//
//   * `orderedJobIds` — the optimized sequence RouteService got back from
//     the Routes API. Captured once when the screen mounts, so it is a snapshot.
//   * `jobs` — the live job objects from the store, which change as the driver
//     completes work.
//
// The pins must follow the optimized sequence while showing live state, so the
// ids are resolved against the current jobs on every render.
//
// This was written as `orderedJobIds.map(id => jobs.find(j => j.id === id))` —
// a linear scan nested inside a map, O(n²), re-run every render. Building an
// index once makes it O(n). At 20-60 pins that is not a user-visible win; it
// matters because the map re-renders on every store change and the cost grows
// quadratically with route length.
export function orderJobsForDisplay(jobs: SignJob[], orderedJobIds: string[]): SignJob[] {
  // No optimized order yet (still loading, or the straight-line fallback):
  // fall back to sheet order. The id tiebreak keeps it deterministic when an
  // import leaves two jobs on the same sort_order.
  if (orderedJobIds.length === 0) {
    return [...jobs].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }

  const byId = new Map(jobs.map((j) => [j.id, j]));

  // Ids with no matching job are dropped rather than rendered as holes.
  // `orderedJobIds` is a snapshot, so it can legitimately name a job that has
  // since left the session — and a hole here becomes a crash on `job.id` at
  // the marker.
  return orderedJobIds
    .map((id) => byId.get(id))
    .filter((j): j is SignJob => j !== undefined);
}
