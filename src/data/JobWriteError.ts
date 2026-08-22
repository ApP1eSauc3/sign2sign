// Error raised when a driver-write RPC (`record_job_photo`, `complete_job`)
// returns a machine-readable failure code in its payload.
//
// Why it carries both a code and a message. Two needs pull in opposite
// directions:
//
//   * The driver needs a sentence they can act on. "invalid_route_code" is
//     useless to someone standing in a paddock in the rain.
//   * The store needs to know WHICH failure it was, because the same code means
//     different things in different contexts. An invalid route code during a
//     live upload means "retry". The same code during an offline-queue flush
//     means finished work may never reach the admin at all — a different, more
//     urgent sentence.
//
// Throwing a plain Error whose message is the raw code forces the store to
// string-match on prose. Translating inside the service throws the code away.
// Carrying both is the only option that serves each layer properly.
//
// This lives in the data layer, not alongside the service, for a concrete
// reason: `src/services/JobPhotoService.ts` imports expo-image-picker and the
// Supabase client, so any test that mocks that module would blank out the
// helper too. Here it has no imports at all and every layer can use the real
// implementation.
export class JobWriteError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'JobWriteError';
  }
}

// Read the failure code off an unknown caught value.
//
// Deliberately duck-typed rather than `instanceof JobWriteError`: a bundler can
// end up with two copies of a class, and `instanceof` fails silently across
// them — returning "some other failure" for what was really an expired code.
// A property read is correct in every case where `instanceof` is, and in
// several where it is not.
export function jobWriteErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const { code } = err as { code: unknown };
  return typeof code === 'string' ? code : undefined;
}
