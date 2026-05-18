import { create } from 'zustand';
import { DriverSession, SignJob, JobUploadState } from '../data/SignJob';
import { RouteCodeService } from '../services/RouteCodeService';
import { JobPhotoService, PhotoLocation } from '../services/JobPhotoService';
import { OfflineQueueService } from '../services/OfflineQueueService';

interface DriverSessionStore {
  session: DriverSession | null;
  uploadStates: Record<string, JobUploadState>;
  markCompleteErrors: Record<string, string>;  // separate from upload state — mark-complete failures don't reset the photo gate
  codeError: string | null;
  isLoadingSession: boolean;

  // Auth
  loadSession: (code: string) => Promise<boolean>;
  clearSession: () => void;

  // Photo gate — the core business rule
  canMarkComplete: (jobId: string) => boolean;

  // Upload state machine
  setUploadState: (jobId: string, state: JobUploadState) => void;

  // Step 1: Open camera, stop at preview for driver review
  capturePhoto: (jobId: string) => Promise<void>;

  // Step 2a: Driver confirms — request GPS and upload
  confirmAndUpload: (jobId: string, location: PhotoLocation) => Promise<void>;

  // Step 2b: Driver retakes — reset to idle (awaits offline-queue clear)
  retakePhoto: (jobId: string) => Promise<void>;

  // Step 2c: Location permission denied — surface a clear retry prompt
  handleLocationDenied: (jobId: string) => void;

  // Step 3: Mark the job complete after photo upload
  markComplete: (jobId: string) => Promise<boolean>;

  // Offline queue
  flushOfflineQueue: () => Promise<void>;

  // Helpers
  getJob: (jobId: string) => SignJob | undefined;
  completedCount: () => number;
}

export const useDriverSession = create<DriverSessionStore>((set, get) => ({
  session: null,
  uploadStates: {},
  markCompleteErrors: {},
  codeError: null,
  isLoadingSession: false,

  // --- Auth ---

  loadSession: async (code) => {
    if (get().isLoadingSession) return false;  // guard against double-fire
    set({ isLoadingSession: true, codeError: null });

    try {
      const session = await RouteCodeService.loadSession(code);
      set({ isLoadingSession: false });

      if (!session) {
        set({ codeError: 'Invalid or expired code. Try again.' });
        return false;
      }

      // Seed upload states: jobs already completed get 'succeeded', others get 'idle'
      const uploadStates: Record<string, JobUploadState> = {};
      for (const job of session.jobs) {
        if (job.isComplete && job.photoKey) {
          uploadStates[job.id] = { status: 'succeeded', photoKey: job.photoKey };
        } else {
          uploadStates[job.id] = { status: 'idle' };
        }
      }

      set({ session, uploadStates });

      // Flush any operations queued during a previous offline session.
      // Runs in the background — don't block the session load.
      get().flushOfflineQueue();

      return true;
    } catch (err) {
      // RouteCodeService.loadSession throws on network/server errors (not on invalid code).
      // Surface the rate-limit message verbatim — it tells the driver how long to wait.
      const message = err instanceof Error ? err.message : '';
      const isRateLimited = message.startsWith('Too many attempts');
      set({
        isLoadingSession: false,
        codeError: isRateLimited
          ? message
          : 'Connection problem — check your signal and try again.',
      });
      return false;
    }
  },

  clearSession: () => set({ session: null, uploadStates: {}, codeError: null }),

  // --- Photo gate ---

  canMarkComplete: (jobId) => {
    return get().uploadStates[jobId]?.status === 'succeeded';
  },

  // --- Upload state machine ---

  setUploadState: (jobId, state) =>
    set((s) => ({
      uploadStates: { ...s.uploadStates, [jobId]: state },
    })),

  // --- Step 1: Capture — open camera and stop at preview ---

  capturePhoto: async (jobId) => {
    const { setUploadState } = get();
    setUploadState(jobId, { status: 'capturing' });

    try {
      const imageUri = await JobPhotoService.capturePhoto();

      if (!imageUri) {
        // User cancelled the camera — not an error, return to idle
        setUploadState(jobId, { status: 'idle' });
        return;
      }

      // Show the captured image to the driver for review before uploading
      setUploadState(jobId, { status: 'preview', imageUri });
    } catch (err: unknown) {
      // Camera permission denied or hardware error
      setUploadState(jobId, {
        status: 'failed',
        message: err instanceof Error ? err.message : 'Could not open camera.',
      });
    }
  },

  // --- Step 2a: Confirm — upload the previewed photo ---

  confirmAndUpload: async (jobId, location) => {
    const state = get().uploadStates[jobId];
    if (state?.status !== 'preview') return;
    const session = get().session;
    if (!session) return;
    const routeCode = session.routeCode;

    const { imageUri } = state;
    const { setUploadState } = get();
    setUploadState(jobId, { status: 'uploading' });

    try {
      const isOnline = await OfflineQueueService.isOnline();
      if (!isOnline) {
        await OfflineQueueService.enqueue({
          type: 'upload',
          jobId,
          imageUri,
          location,
          routeCode,
          queuedAt: Date.now(),
        });
        setUploadState(jobId, {
          status: 'failed',
          message: 'No connection — photo queued and will upload automatically when online.',
        });
        return;
      }

      const result = await JobPhotoService.uploadPhoto(jobId, imageUri, location, routeCode);
      setUploadState(jobId, { status: 'succeeded', photoKey: result.photoKey });

      // Update local session state with photo data
      set((s) => {
        if (!s.session) return s;
        return {
          session: {
            ...s.session,
            jobs: s.session.jobs.map((j) =>
              j.id === jobId
                ? {
                    ...j,
                    photoKey: result.photoKey,
                    photoGPSLat: result.latitude,
                    photoGPSLng: result.longitude,
                    photoTimestamp: result.timestamp,
                  }
                : j
            ),
          },
        };
      });
    } catch (err: unknown) {
      setUploadState(jobId, {
        status: 'failed',
        message: err instanceof Error ? err.message : 'Upload failed. Try again.',
      });
    }
  },

  // --- Step 2b: Retake — discard preview and restart ---

  retakePhoto: async (jobId) => {
    // Clear any queued upload BEFORE flipping state. If we voided the remove
    // and the offline queue flushed concurrently, the stale photo could still
    // upload after the driver started a retake.
    await OfflineQueueService.remove(jobId, 'upload');
    get().setUploadState(jobId, { status: 'idle' });
  },

  // --- Step 2c: Location denied — surface a clear retry prompt ---

  handleLocationDenied: (jobId) => {
    get().setUploadState(jobId, {
      status: 'failed',
      message:
        'Location access is required to record where this job was completed. Enable it in Settings, then tap Retry Photo.',
    });
  },

  // --- Step 3: Mark complete — only callable when canMarkComplete is true ---

  markComplete: async (jobId) => {
    const { canMarkComplete, session } = get();
    if (!canMarkComplete(jobId)) return false;
    // canMarkComplete only checks uploadStates, not session. A clearSession()
    // racing with this call would otherwise crash on the non-null assertion.
    if (!session) return false;

    // Clear any previous mark-complete error for this job before attempting
    set((s) => ({ markCompleteErrors: { ...s.markCompleteErrors, [jobId]: '' } }));

    try {
      const routeCode = session.routeCode;
      const isOnline = await OfflineQueueService.isOnline();
      if (!isOnline) {
        await OfflineQueueService.enqueue({ type: 'markComplete', jobId, routeCode, queuedAt: Date.now() });
        // Optimistically mark complete locally — will sync when online
        set((s) => {
          if (!s.session) return s;
          return {
            session: {
              ...s.session,
              jobs: s.session.jobs.map((j) =>
                j.id === jobId ? { ...j, isComplete: true } : j
              ),
            },
          };
        });
        return true; // queued counts as success from the driver's perspective
      }

      await JobPhotoService.markJobComplete(jobId, routeCode);

      set((s) => {
        if (!s.session) return s;
        return {
          session: {
            ...s.session,
            jobs: s.session.jobs.map((j) =>
              j.id === jobId ? { ...j, isComplete: true } : j
            ),
          },
        };
      });
      return true;
    } catch (err: unknown) {
      // Keep uploadState as 'succeeded' — photo is still uploaded, only the DB write failed.
      // Surface the error separately so the driver can retry Mark Complete, not Retry Photo.
      set((s) => ({
        markCompleteErrors: {
          ...s.markCompleteErrors,
          [jobId]: err instanceof Error ? err.message : 'Could not mark complete. Try again.',
        },
      }));
      return false;
    }
  },

  // --- Offline queue ---

  flushOfflineQueue: async () => {
    const { setUploadState } = get();
    await OfflineQueueService.flush({
      onUpload: async (op) => {
        setUploadState(op.jobId, { status: 'uploading' });
        try {
          const result = await JobPhotoService.uploadPhoto(op.jobId, op.imageUri, op.location, op.routeCode);
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
      onMarkComplete: async (op) => {
        await JobPhotoService.markJobComplete(op.jobId, op.routeCode);
      },
    });
  },

  // --- Helpers ---

  getJob: (jobId) => get().session?.jobs.find((j) => j.id === jobId),

  completedCount: () => get().session?.jobs.filter((j) => j.isComplete).length ?? 0,
}));
