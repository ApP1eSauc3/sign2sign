// Bounded-concurrency map. Workers pull from a shared cursor, so a slow item
// never idles the pool the way a fixed chunk-per-worker split would.
//
// On failure it stops dispatching new work but reports the error belonging to
// the LOWEST index, not whichever rejected first. Import errors name a row
// number, and a row number that changes between identical runs because of
// network timing is a support call waiting to happen.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<{ results: R[]; failure?: { index: number; error: unknown } }> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failure: { index: number; error: unknown } | undefined;
  // Separate from `failure` so the early-return guard does not narrow it away
  // in the catch block below.
  let aborted = false;

  async function runWorker(): Promise<void> {
    for (;;) {
      if (aborted) return;              // stop starting new work once one has failed
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        aborted = true;
        // Workers can fail concurrently — keep the lowest index, not the first
        // rejection to land.
        if (failure === undefined || index < failure.index) failure = { index, error };
        return;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker())
  );

  return { results, failure };
}
