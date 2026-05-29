import { useDriverSession } from '../useDriverSession';
import { RouteCodeService } from '../../services/RouteCodeService';
import { JobPhotoService } from '../../services/JobPhotoService';
import { OfflineQueueService } from '../../services/OfflineQueueService';
import { SignJob } from '../../data/SignJob';

jest.mock('../../services/RouteCodeService', () => ({
  RouteCodeService: { loadSession: jest.fn() },
}));
jest.mock('../../services/JobPhotoService', () => ({
  JobPhotoService: { capturePhoto: jest.fn(), uploadPhoto: jest.fn(), markJobComplete: jest.fn() },
}));
jest.mock('../../services/OfflineQueueService', () => ({
  OfflineQueueService: {
    isOnline: jest.fn().mockResolvedValue(true),
    enqueue: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue({ succeeded: [], failed: [] }),
  },
}));

const mockLoadSession = RouteCodeService.loadSession as jest.Mock;
const mockCapturePhoto = JobPhotoService.capturePhoto as jest.Mock;
const mockUploadPhoto = JobPhotoService.uploadPhoto as jest.Mock;
const mockMarkComplete = JobPhotoService.markJobComplete as jest.Mock;
const mockIsOnline = OfflineQueueService.isOnline as jest.Mock;

function makeJob(over: Partial<SignJob> = {}): SignJob {
  return {
    id: 'job-1',
    clientName: 'Harcourts',
    agentName: 'Jane',
    agentEmail: '',
    address: '42 Maple St',
    signDescription: 'Corflute',
    jobType: 'install',
    latitude: -31.95,
    longitude: 115.86,
    sortOrder: 1,
    isComplete: false,
    ...over,
  };
}

// Reset store to initial shape between tests (clearMocks handles the jest.fn()s).
beforeEach(() => {
  useDriverSession.setState({
    session: null,
    uploadStates: {},
    markCompleteErrors: {},
    codeError: null,
    isLoadingSession: false,
  });
  mockIsOnline.mockResolvedValue(true);
});

describe('canMarkComplete — the photo gate', () => {
  it.each([
    ['idle', { status: 'idle' }],
    ['capturing', { status: 'capturing' }],
    ['preview', { status: 'preview', imageUri: 'file://x.jpg' }],
    ['uploading', { status: 'uploading' }],
    ['failed', { status: 'failed', message: 'boom' }],
  ])('returns false when upload state is %s', (_label, state) => {
    useDriverSession.setState({ uploadStates: { 'job-1': state as any } });
    expect(useDriverSession.getState().canMarkComplete('job-1')).toBe(false);
  });

  it('returns true only when succeeded', () => {
    useDriverSession.setState({
      uploadStates: { 'job-1': { status: 'succeeded', photoKey: 'jobs/job-1/p.jpg' } },
    });
    expect(useDriverSession.getState().canMarkComplete('job-1')).toBe(true);
  });

  it('returns false for an unknown job', () => {
    expect(useDriverSession.getState().canMarkComplete('nope')).toBe(false);
  });
});

describe('loadSession — upload-state seeding', () => {
  it('seeds succeeded for completed jobs with a photo, idle otherwise', async () => {
    mockLoadSession.mockResolvedValue({
      routeCode: '123456',
      driverSlot: 1,
      jobs: [
        makeJob({ id: 'done', isComplete: true, photoKey: 'jobs/done/p.jpg' }),
        makeJob({ id: 'todo', isComplete: false }),
        makeJob({ id: 'complete-no-photo', isComplete: true }), // no photoKey -> idle
      ],
    });

    const ok = await useDriverSession.getState().loadSession('123456');
    const { uploadStates, session } = useDriverSession.getState();

    expect(ok).toBe(true);
    expect(session?.routeCode).toBe('123456');
    expect(uploadStates['done']).toEqual({ status: 'succeeded', photoKey: 'jobs/done/p.jpg' });
    expect(uploadStates['todo']).toEqual({ status: 'idle' });
    expect(uploadStates['complete-no-photo']).toEqual({ status: 'idle' });
  });

  it('sets the invalid-code error and returns false when session is null', async () => {
    mockLoadSession.mockResolvedValue(null);
    const ok = await useDriverSession.getState().loadSession('000000');
    expect(ok).toBe(false);
    expect(useDriverSession.getState().codeError).toBe('Invalid or expired code. Try again.');
    expect(useDriverSession.getState().isLoadingSession).toBe(false);
  });

  it('surfaces the rate-limit message verbatim', async () => {
    mockLoadSession.mockRejectedValue(new Error('Too many attempts. Wait a minute and try again.'));
    const ok = await useDriverSession.getState().loadSession('123456');
    expect(ok).toBe(false);
    expect(useDriverSession.getState().codeError).toBe('Too many attempts. Wait a minute and try again.');
  });

  it('maps other errors to a generic connection message', async () => {
    mockLoadSession.mockRejectedValue(new Error('socket hang up'));
    await useDriverSession.getState().loadSession('123456');
    expect(useDriverSession.getState().codeError).toBe(
      'Connection problem — check your signal and try again.'
    );
  });

  it('guards against double-fire while a load is in flight', async () => {
    useDriverSession.setState({ isLoadingSession: true });
    const ok = await useDriverSession.getState().loadSession('123456');
    expect(ok).toBe(false);
    expect(mockLoadSession).not.toHaveBeenCalled();
  });
});

describe('upload state machine', () => {
  it('capturePhoto: idle -> preview on a captured image', async () => {
    mockCapturePhoto.mockResolvedValue('file://photo.jpg');
    await useDriverSession.getState().capturePhoto('job-1');
    expect(useDriverSession.getState().uploadStates['job-1']).toEqual({
      status: 'preview',
      imageUri: 'file://photo.jpg',
    });
  });

  it('capturePhoto: returns to idle when the user cancels (null uri)', async () => {
    mockCapturePhoto.mockResolvedValue(null);
    await useDriverSession.getState().capturePhoto('job-1');
    expect(useDriverSession.getState().uploadStates['job-1']).toEqual({ status: 'idle' });
  });

  it('capturePhoto: surfaces a permission error as failed', async () => {
    mockCapturePhoto.mockRejectedValue(new Error('Camera access is required to take job photos. Enable it in Settings.'));
    await useDriverSession.getState().capturePhoto('job-1');
    const s = useDriverSession.getState().uploadStates['job-1'];
    expect(s.status).toBe('failed');
    expect((s as any).message).toMatch(/Camera access is required/);
  });

  it('confirmAndUpload: preview -> succeeded and writes photo data into the session', async () => {
    useDriverSession.setState({
      session: { routeCode: '123456', driverSlot: 1, jobs: [makeJob({ id: 'job-1' })] },
      uploadStates: { 'job-1': { status: 'preview', imageUri: 'file://photo.jpg' } },
    });
    mockUploadPhoto.mockResolvedValue({
      photoKey: 'jobs/job-1/p.jpg',
      latitude: -31.9,
      longitude: 115.8,
      timestamp: new Date('2026-05-29T00:00:00Z'),
    });

    await useDriverSession.getState().confirmAndUpload('job-1', { latitude: -31.9, longitude: 115.8 });

    expect(useDriverSession.getState().uploadStates['job-1']).toEqual({
      status: 'succeeded',
      photoKey: 'jobs/job-1/p.jpg',
    });
    expect(mockUploadPhoto).toHaveBeenCalledWith('job-1', 'file://photo.jpg', { latitude: -31.9, longitude: 115.8 }, '123456');
    expect(useDriverSession.getState().getJob('job-1')?.photoKey).toBe('jobs/job-1/p.jpg');
  });

  it('confirmAndUpload: is a no-op unless state is preview', async () => {
    useDriverSession.setState({
      session: { routeCode: '123456', driverSlot: 1, jobs: [makeJob()] },
      uploadStates: { 'job-1': { status: 'idle' } },
    });
    await useDriverSession.getState().confirmAndUpload('job-1', { latitude: 0, longitude: 0 });
    expect(mockUploadPhoto).not.toHaveBeenCalled();
    expect(useDriverSession.getState().uploadStates['job-1']).toEqual({ status: 'idle' });
  });

  it('confirmAndUpload: queues offline and reports the queued message', async () => {
    useDriverSession.setState({
      session: { routeCode: '123456', driverSlot: 1, jobs: [makeJob()] },
      uploadStates: { 'job-1': { status: 'preview', imageUri: 'file://photo.jpg' } },
    });
    mockIsOnline.mockResolvedValue(false);

    await useDriverSession.getState().confirmAndUpload('job-1', { latitude: 0, longitude: 0 });

    expect(OfflineQueueService.enqueue).toHaveBeenCalled();
    expect(mockUploadPhoto).not.toHaveBeenCalled();
    const s = useDriverSession.getState().uploadStates['job-1'];
    expect(s.status).toBe('failed');
    expect((s as any).message).toMatch(/queued and will upload automatically/);
  });

  it('retakePhoto: clears any queued upload before returning to idle', async () => {
    useDriverSession.setState({ uploadStates: { 'job-1': { status: 'preview', imageUri: 'x' } } });
    await useDriverSession.getState().retakePhoto('job-1');
    expect(OfflineQueueService.remove).toHaveBeenCalledWith('job-1', 'upload');
    expect(useDriverSession.getState().uploadStates['job-1']).toEqual({ status: 'idle' });
  });
});

describe('markComplete — gated on the photo upload', () => {
  it('refuses (returns false) when the gate is not satisfied', async () => {
    useDriverSession.setState({
      session: { routeCode: '123456', driverSlot: 1, jobs: [makeJob()] },
      uploadStates: { 'job-1': { status: 'idle' } },
    });
    const ok = await useDriverSession.getState().markComplete('job-1');
    expect(ok).toBe(false);
    expect(mockMarkComplete).not.toHaveBeenCalled();
  });

  it('completes when succeeded and marks the job complete locally', async () => {
    useDriverSession.setState({
      session: { routeCode: '123456', driverSlot: 1, jobs: [makeJob({ id: 'job-1' })] },
      uploadStates: { 'job-1': { status: 'succeeded', photoKey: 'jobs/job-1/p.jpg' } },
    });
    mockMarkComplete.mockResolvedValue(undefined);

    const ok = await useDriverSession.getState().markComplete('job-1');

    expect(ok).toBe(true);
    expect(mockMarkComplete).toHaveBeenCalledWith('job-1', '123456');
    expect(useDriverSession.getState().getJob('job-1')?.isComplete).toBe(true);
  });

  it('records a mark-complete error without resetting the photo gate', async () => {
    useDriverSession.setState({
      session: { routeCode: '123456', driverSlot: 1, jobs: [makeJob({ id: 'job-1' })] },
      uploadStates: { 'job-1': { status: 'succeeded', photoKey: 'jobs/job-1/p.jpg' } },
    });
    mockMarkComplete.mockRejectedValue(new Error('Could not mark complete. Try again.'));

    const ok = await useDriverSession.getState().markComplete('job-1');

    expect(ok).toBe(false);
    expect(useDriverSession.getState().markCompleteErrors['job-1']).toBe('Could not mark complete. Try again.');
    // Gate stays succeeded — the photo is uploaded; only the DB write failed.
    expect(useDriverSession.getState().canMarkComplete('job-1')).toBe(true);
  });

  it('optimistically completes offline and queues the operation', async () => {
    useDriverSession.setState({
      session: { routeCode: '123456', driverSlot: 1, jobs: [makeJob({ id: 'job-1' })] },
      uploadStates: { 'job-1': { status: 'succeeded', photoKey: 'jobs/job-1/p.jpg' } },
    });
    mockIsOnline.mockResolvedValue(false);

    const ok = await useDriverSession.getState().markComplete('job-1');

    expect(ok).toBe(true);
    expect(OfflineQueueService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'markComplete', jobId: 'job-1', routeCode: '123456' })
    );
    expect(mockMarkComplete).not.toHaveBeenCalled();
    expect(useDriverSession.getState().getJob('job-1')?.isComplete).toBe(true);
  });
});

describe('helpers', () => {
  it('completedCount counts only completed jobs', () => {
    useDriverSession.setState({
      session: {
        routeCode: '123456',
        driverSlot: 1,
        jobs: [
          makeJob({ id: 'a', isComplete: true }),
          makeJob({ id: 'b', isComplete: false }),
          makeJob({ id: 'c', isComplete: true }),
        ],
      },
    });
    expect(useDriverSession.getState().completedCount()).toBe(2);
  });
});
