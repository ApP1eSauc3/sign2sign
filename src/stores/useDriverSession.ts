import { create } from 'zustand';
import { DriverSession, SignJob, JobUploadState } from '../data/SignJob';
import { RouteCodeService } from '../services/RouteCodeService';
import { JobPhotoService, PhotoLocation } from '../services/JobPhotoService';
import { OfflineQueueService } from '../services/OfflineQueueService';
import { seedUploadStates, patchSessionJob } from './driverSession/sessionJobs';
import { createFlushHandlers } from './driverSession/offlineFlush';

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

      set({ session, uploadStates: seedUploadStates(session.jobs) });

      // Flush any operations queued during a previous offline session.
      // Runs in the background — don't block the session load.
      get().flushOfflineQueue();

      return true;
    } catch (err) {
      // RouteCodeService.loadSession throws on network/server errors (not on
      // invalid code), and every message it throws is already driver-facing
      // copy — its contract says to surface them verbatim. So pass the message
      // through rather than re-deciding what went wrong here.
      //
      // This used to collapse everything except the rate-limit case into
      // "Connection problem — check your signal and try again." That copy sent
      // a driver to check their reception for a fault that had nothing to do
      // with the network: the first real-device build failed inside
      // getOrCreateClientId, before any request was made, and reported itself
      // as a signal problem. A driver in a field would have power-cycled the
      // phone. Only a genuinely unknown throw gets a generic message now.
      const message = err instanceof Error ? err.message.trim() : '';
      if (!message) console.error('[driver] loadSession failed with no message:', err);
      set({
        isLoadingSession: false,
        codeError: message || 'Something went wrong loading the route. Please try again.',
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
        await OfflineQueueService.enqueue(
          { type: 'upload', jobId, imageUri, location, queuedAt: Date.now() },
          routeCode
        );
        setUploadState(jobId, {
          status: 'failed',
          message: 'No connection — photo queued and will upload automatically when online.',
        });
        return;
      }

      const result = await JobPhotoService.uploadPhoto(jobId, imageUri, location, routeCode);
      setUploadState(jobId, { status: 'succeeded', photoKey: result.photoKey });

      // Update local session state with photo data
      set((s) =>
        s.session
          ? {
              session: patchSessionJob(s.session, jobId, {
                photoKey: result.photoKey,
                photoGPSLat: result.latitude,
                photoGPSLng: result.longitude,
                photoTimestamp: result.timestamp,
              }),
            }
          : s
      );
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
        await OfflineQueueService.enqueue(
          { type: 'markComplete', jobId, queuedAt: Date.now() },
          routeCode
        );
        // Optimistically mark complete locally — will sync when online
        set((s) =>
          s.session ? { session: patchSessionJob(s.session, jobId, { isComplete: true }) } : s
        );
        return true; // queued counts as success from the driver's perspective
      }

      await JobPhotoService.markJobComplete(jobId, routeCode);

      set((s) =>
        s.session ? { session: patchSessionJob(s.session, jobId, { isComplete: true }) } : s
      );
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
    await OfflineQueueService.flush(
      createFlushHandlers({
        setUploadState: get().setUploadState,
        setMarkCompleteError: (jobId, message) =>
          set((s) => ({ markCompleteErrors: { ...s.markCompleteErrors, [jobId]: message } })),
      })
    );
  },

  // --- Helpers ---

  getJob: (jobId) => get().session?.jobs.find((j) => j.id === jobId),

  completedCount: () => get().session?.jobs.filter((j) => j.isComplete).length ?? 0,
}));
