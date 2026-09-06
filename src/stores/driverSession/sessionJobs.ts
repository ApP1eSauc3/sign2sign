import { DriverSession, SignJob, JobUploadState } from '../../data/SignJob';

// Seed upload states: jobs already completed get 'succeeded', others get 'idle'
export function seedUploadStates(jobs: SignJob[]): Record<string, JobUploadState> {
  const uploadStates: Record<string, JobUploadState> = {};
  for (const job of jobs) {
    if (job.isComplete && job.photoKey) {
      uploadStates[job.id] = { status: 'succeeded', photoKey: job.photoKey };
    } else {
      uploadStates[job.id] = { status: 'idle' };
    }
  }
  return uploadStates;
}

// Apply a partial update to one job inside the session, leaving every other
// job identity-stable so memoised list rows don't re-render.
//
// The store patched jobs in three places with three copies of this same
// spread-and-map — photo fields after an upload, and `isComplete` on both the
// queued and the live mark-complete path. One copy, so a future field can
// never be added to two of the three.
export function patchSessionJob(
  session: DriverSession,
  jobId: string,
  patch: Partial<SignJob>
): DriverSession {
  return {
    ...session,
    jobs: session.jobs.map((j) => (j.id === jobId ? { ...j, ...patch } : j)),
  };
}
