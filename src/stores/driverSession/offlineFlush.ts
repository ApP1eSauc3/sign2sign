import { JobUploadState } from '../../data/SignJob';
import { JobPhotoService } from '../../services/JobPhotoService';
import { OfflineQueueService, QueuedOperation } from '../../services/OfflineQueueService';
import { jobWriteErrorCode } from '../../data/JobWriteError';

type FlushHandlers = Parameters<typeof OfflineQueueService.flush>[0];

type FlushDeps = {
  setUploadState: (jobId: string, state: JobUploadState) => void;
  setMarkCompleteError: (jobId: string, message: string) => void;
};

// The handlers OfflineQueueService.flush calls for each queued operation.
// Built from the store's two setters rather than reaching into the store, so
// this module stays a pure function of its dependencies.
export function createFlushHandlers({
  setUploadState,
  setMarkCompleteError,
}: FlushDeps): FlushHandlers {
  return {
    onUpload: async (op: Extract<QueuedOperation, { type: 'upload' }>, routeCode: string) => {
      setUploadState(op.jobId, { status: 'uploading' });
      try {
        const result = await JobPhotoService.uploadPhoto(op.jobId, op.imageUri, op.location, routeCode);
        setUploadState(op.jobId, { status: 'succeeded', photoKey: result.photoKey });
      } catch (err: unknown) {
        // Let the queue service know this op failed (it re-queues for next flush).
        // Reset upload state so the driver sees a retry prompt instead of a stuck spinner.
        setUploadState(op.jobId, {
          status: 'failed',
          message: err instanceof Error ? err.message : 'Upload failed. Try again.',
        });
        throw err; // propagate so OfflineQueueService.flush records this as failed
      }
    },
    onMarkComplete: async (op: Extract<QueuedOperation, { type: 'markComplete' }>, routeCode: string) => {
      try {
        await JobPhotoService.markJobComplete(op.jobId, routeCode);
      } catch (err: unknown) {
        // A queued mark-complete was previously shown to the driver as an
        // optimistic success — a silent flush failure here means the admin
        // never learns the job was done. Surface it so the job screen shows
        // a retryable error instead of nothing.
        // Branch on the RPC's error CODE, not on its message. The same code
        // means different things in different contexts: an invalid code during
        // a live mark-complete is "retry", but during an offline-queue flush
        // it means this finished work may never reach the admin at all — so
        // the wording here is deliberately not the service's default.
        const code = jobWriteErrorCode(err);
        setMarkCompleteError(
          op.jobId,
          code === 'invalid_route_code'
            ? 'Could not sync this completed job — the route code is no longer valid. Tell dispatch which jobs you finished so they can record them.'
            : 'Could not sync this completed job. It will retry next time you go online.'
        );
        throw err; // keep the op queued for the next flush
      }
    },
  };
}
