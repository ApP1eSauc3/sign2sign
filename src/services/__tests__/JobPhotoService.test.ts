import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { JobPhotoService } from '../JobPhotoService';
import { supabase } from '../supabaseClient';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('../supabaseClient', () => ({
  supabase: {
    storage: { from: jest.fn() },
    rpc: jest.fn(),
  },
}));

const mockPermissions = ImagePicker.requestCameraPermissionsAsync as jest.Mock;
const mockLaunchCamera = ImagePicker.launchCameraAsync as jest.Mock;
const mockManipulate = ImageManipulator.manipulateAsync as jest.Mock;
const mockRpc = supabase.rpc as unknown as jest.Mock;
const mockStorageFrom = supabase.storage.from as unknown as jest.Mock;

const LOCATION = { latitude: -31.9505, longitude: 115.8605 };

// Storage bucket double. Records what was uploaded so key/content-type
// assertions can read it back.
function installStorage(over: { uploadError?: { message: string }; signedUrl?: string | null } = {}) {
  const upload = jest.fn().mockResolvedValue({ error: over.uploadError ?? null });
  const createSignedUrl = jest.fn().mockResolvedValue({
    data: over.signedUrl === undefined ? { signedUrl: 'https://signed.example/x' } : (over.signedUrl === null ? null : { signedUrl: over.signedUrl }),
  });
  mockStorageFrom.mockReturnValue({ upload, createSignedUrl });
  return { upload, createSignedUrl };
}

function rpcOk(over: Record<string, unknown> = {}) {
  return {
    data: {
      ok: true,
      already_recorded: false,
      photo_key: null,
      photo_gps_lat: LOCATION.latitude,
      photo_gps_lng: LOCATION.longitude,
      photo_timestamp: null,
      ...over,
    },
    error: null,
  };
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ blob: async () => 'BLOB' });
  installStorage();
});

// ─── capturePhoto ────────────────────────────────────────────────────────────

describe('capturePhoto', () => {
  it('throws an actionable message when camera permission is denied', async () => {
    mockPermissions.mockResolvedValue({ granted: false });
    await expect(JobPhotoService.capturePhoto()).rejects.toThrow(/Camera access is required/i);
    expect(mockLaunchCamera).not.toHaveBeenCalled();
  });

  it('returns null when the driver cancels — a cancel is not an error', async () => {
    mockPermissions.mockResolvedValue({ granted: true });
    mockLaunchCamera.mockResolvedValue({ canceled: true, assets: [] });

    await expect(JobPhotoService.capturePhoto()).resolves.toBeNull();
    expect(mockManipulate).not.toHaveBeenCalled();
  });

  // The 2026-08-19 fix. A camera capture carries the phone's own GPS fix in its
  // EXIF block; re-encoding drops it. Previously the re-encode sat behind a
  // needsResize check, so an already-small photo uploaded with EXIF intact.
  it('re-encodes even when no resize is needed, so EXIF is always stripped', async () => {
    mockPermissions.mockResolvedValue({ granted: true });
    mockLaunchCamera.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///raw.jpg', width: 800, height: 600 }],
    });
    mockManipulate.mockResolvedValue({ uri: 'file:///clean.jpg' });

    const uri = await JobPhotoService.capturePhoto();

    expect(mockManipulate).toHaveBeenCalledTimes(1);
    // Empty action list — the re-encode itself is the metadata strip.
    expect(mockManipulate).toHaveBeenCalledWith('file:///raw.jpg', [], expect.objectContaining({ format: 'jpeg' }));
    expect(uri).toBe('file:///clean.jpg');
  });

  it('resizes on the longest axis for a landscape capture', async () => {
    mockPermissions.mockResolvedValue({ granted: true });
    mockLaunchCamera.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///big.jpg', width: 4000, height: 3000 }],
    });
    mockManipulate.mockResolvedValue({ uri: 'file:///small.jpg' });

    await JobPhotoService.capturePhoto();

    expect(mockManipulate).toHaveBeenCalledWith(
      'file:///big.jpg',
      [{ resize: { width: 1600 } }],
      expect.anything()
    );
  });

  it('resizes on height for a portrait capture', async () => {
    mockPermissions.mockResolvedValue({ granted: true });
    mockLaunchCamera.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tall.jpg', width: 3000, height: 4000 }],
    });
    mockManipulate.mockResolvedValue({ uri: 'file:///small.jpg' });

    await JobPhotoService.capturePhoto();

    expect(mockManipulate).toHaveBeenCalledWith(
      'file:///tall.jpg',
      [{ resize: { height: 1600 } }],
      expect.anything()
    );
  });
});

// ─── uploadPhoto ─────────────────────────────────────────────────────────────

describe('uploadPhoto — storage key shaping', () => {
  it('builds a server-shaped key and never trusts the camera extension', async () => {
    const { upload } = installStorage();
    mockRpc.mockResolvedValue(rpcOk({ photo_key: 'set-below' }));

    // Query string and an unexpected suffix — both must be stripped.
    await JobPhotoService.uploadPhoto('job-1', 'file:///IMG_0001.JPEG?width=100', LOCATION, '123456');

    const [key, blob, opts] = upload.mock.calls[0];
    expect(key).toMatch(/^jobs\/job-1\/\d+\.jpg$/);
    expect(blob).toBe('BLOB');
    expect(opts).toEqual({ contentType: 'image/jpeg', upsert: false });
  });

  it.each([
    ['file:///a.png', /\.png$/, 'image/png'],
    ['file:///a.webp', /\.webp$/, 'image/webp'],
    ['file:///a.jpg', /\.jpg$/, 'image/jpeg'],
    // Not on the allowlist — falls back to jpeg rather than interpolating it
    // into the key or the Content-Type header.
    ['file:///a.svg', /\.jpg$/, 'image/jpeg'],
    ['file:///a', /\.jpg$/, 'image/jpeg'],
  ])('maps %s to a whitelisted extension and MIME type', async (uri, keyPattern, contentType) => {
    const { upload } = installStorage();
    mockRpc.mockResolvedValue(rpcOk({ photo_key: 'x' }));

    await JobPhotoService.uploadPhoto('job-1', uri, LOCATION, '123456');

    expect(upload.mock.calls[0][0]).toMatch(keyPattern);
    expect(upload.mock.calls[0][2].contentType).toBe(contentType);
  });

  it('does not record the photo if the storage upload failed', async () => {
    installStorage({ uploadError: { message: 'bucket full' } });

    await expect(
      JobPhotoService.uploadPhoto('job-1', 'file:///a.jpg', LOCATION, '123456')
    ).rejects.toThrow('bucket full');

    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('uploadPhoto — record_job_photo RPC (migration 013)', () => {
  it('records via the RPC, not a direct table update', async () => {
    const { upload } = installStorage();
    mockRpc.mockImplementation(async (_fn: string, args: { p_photo_key: string }) =>
      rpcOk({ photo_key: args.p_photo_key })
    );

    const result = await JobPhotoService.uploadPhoto('job-1', 'file:///a.jpg', LOCATION, '123456');

    expect(mockRpc).toHaveBeenCalledWith('record_job_photo', {
      p_job_id: 'job-1',
      p_route_code: '123456',
      p_photo_key: upload.mock.calls[0][0],
      p_lat: LOCATION.latitude,
      p_lng: LOCATION.longitude,
      p_timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(result.photoKey).toBe(upload.mock.calls[0][0]);
    expect(result.latitude).toBe(LOCATION.latitude);
  });

  // photo_key is write-once. If an earlier attempt landed but the response was
  // lost, the STORED values are the truth, not the ones we just generated.
  it('returns the stored values when the photo was already recorded', async () => {
    mockRpc.mockResolvedValue({
      data: {
        ok: true,
        already_recorded: true,
        photo_key: 'jobs/job-1/111111.jpg',
        photo_gps_lat: -32.1,
        photo_gps_lng: 116.2,
        photo_timestamp: '2026-08-21T02:03:04.000Z',
      },
      error: null,
    });

    const result = await JobPhotoService.uploadPhoto('job-1', 'file:///a.jpg', LOCATION, '123456');

    expect(result.photoKey).toBe('jobs/job-1/111111.jpg');
    expect(result.latitude).toBe(-32.1);
    expect(result.longitude).toBe(116.2);
    expect(result.timestamp.toISOString()).toBe('2026-08-21T02:03:04.000Z');
  });

  it.each([
    ['invalid_route_code', /route code is no longer valid/i],
    ['job_not_found', /not on your route any more/i],
    ['invalid_photo_key', /Take it again/i],
    ['invalid_location', /Location Services/i],
  ])('translates the %s error code into something a driver can act on', async (code, message) => {
    mockRpc.mockResolvedValue({ data: { error: code }, error: null });

    await expect(
      JobPhotoService.uploadPhoto('job-1', 'file:///a.jpg', LOCATION, '123456')
    ).rejects.toThrow(message);
  });

  it('passes through an unrecognised error code rather than swallowing it', async () => {
    mockRpc.mockResolvedValue({ data: { error: 'something_new' }, error: null });

    await expect(
      JobPhotoService.uploadPhoto('job-1', 'file:///a.jpg', LOCATION, '123456')
    ).rejects.toThrow('something_new');
  });

  it('throws on a transport-level RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'network down' } });

    await expect(
      JobPhotoService.uploadPhoto('job-1', 'file:///a.jpg', LOCATION, '123456')
    ).rejects.toThrow('network down');
  });

  it.each([
    ['null payload', null],
    ['no photo_key', { ok: true }],
  ])('rejects a malformed RPC payload (%s) instead of returning a bad key', async (_label, data) => {
    mockRpc.mockResolvedValue({ data, error: null });

    await expect(
      JobPhotoService.uploadPhoto('job-1', 'file:///a.jpg', LOCATION, '123456')
    ).rejects.toThrow(/Unexpected response/i);
  });
});

// ─── markJobComplete ─────────────────────────────────────────────────────────

describe('markJobComplete', () => {
  it('calls complete_job with the job and the authorizing route code', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });

    await JobPhotoService.markJobComplete('job-1', '123456');

    expect(mockRpc).toHaveBeenCalledWith('complete_job', {
      p_job_id: 'job-1',
      p_route_code: '123456',
    });
  });

  it('treats an already-complete job as success — the queue retries', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, already_complete: true }, error: null });
    await expect(JobPhotoService.markJobComplete('job-1', '123456')).resolves.toBeUndefined();
  });

  // The code is carried on the error so the store can branch on it, while the
  // message stays readable. Neither half is optional: translating alone would
  // throw the code away, and throwing the raw code alone forces string-matching.
  it.each([
    ['invalid_route_code', /route code is no longer valid/i],
    ['job_not_found', /not on your route any more/i],
    ['photo_required', /Take the job photo before/i],
  ])('carries the %s code and a readable message', async (code, message) => {
    mockRpc.mockResolvedValue({ data: { error: code }, error: null });

    await expect(JobPhotoService.markJobComplete('job-1', '123456')).rejects.toMatchObject({
      code,
      message: expect.stringMatching(message),
    });
  });

  it('passes an unrecognised code straight through as both code and message', async () => {
    mockRpc.mockResolvedValue({ data: { error: 'something_new' }, error: null });
    await expect(JobPhotoService.markJobComplete('job-1', '123456')).rejects.toMatchObject({
      code: 'something_new',
      message: 'something_new',
    });
  });

  it('throws on a transport-level error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    await expect(JobPhotoService.markJobComplete('job-1', '123456')).rejects.toThrow('timeout');
  });
});

// ─── getSignedUrl ────────────────────────────────────────────────────────────

describe('getSignedUrl', () => {
  it('signs at display time with a 1-hour TTL and never persists the result', async () => {
    const { createSignedUrl } = installStorage({ signedUrl: 'https://signed.example/photo' });

    const url = await JobPhotoService.getSignedUrl('jobs/job-1/1.jpg');

    expect(mockStorageFrom).toHaveBeenCalledWith('job-photos');
    expect(createSignedUrl).toHaveBeenCalledWith('jobs/job-1/1.jpg', 3600);
    expect(url).toBe('https://signed.example/photo');
  });

  it('returns null rather than throwing when signing fails', async () => {
    installStorage({ signedUrl: null });
    await expect(JobPhotoService.getSignedUrl('jobs/job-1/1.jpg')).resolves.toBeNull();
  });
});

// ─── Cross-layer contract: client key shape vs the migration's regex ─────────
//
// record_job_photo() rejects any photo_key that is not this job's own prefix,
// so a drift between the key JobPhotoService builds and the pattern the RPC
// accepts breaks every upload in production — the exact class of failure that
// took the driver flow down in the first place. Read the pattern out of the
// migration rather than restating it here, so the two cannot drift silently.

describe('photo_key contract with migration 013', () => {
  const fs = require('fs') as typeof import('fs');
  const migration = fs.readFileSync('supabase/migrations/013_record_job_photo.sql', 'utf8');

  // The literal inside: p_photo_key !~ ('^jobs/' || p_job_id::text || '<TAIL>')
  const tail = migration.match(/p_job_id::text \|\| '([^']+)'/);

  it('the migration still guards photo_key with a job-scoped pattern', () => {
    expect(tail).not.toBeNull();
  });

  it.each(['file:///a.jpg', 'file:///a.JPEG?x=1', 'file:///a.png', 'file:///a.webp', 'file:///a'])(
    'the key generated for %s satisfies the RPC pattern',
    async (uri) => {
      const jobId = '3f6c1a2e-8b7d-4c5e-9a0f-1d2e3b4c5d6e'; // uuid, as in prod
      const { upload } = installStorage();
      mockRpc.mockResolvedValue(rpcOk({ photo_key: 'x' }));

      await JobPhotoService.uploadPhoto(jobId, uri, LOCATION, '123456');
      const key = upload.mock.calls[0][0] as string;

      const pattern = new RegExp('^jobs/' + jobId + tail![1].replace(/\\\\/g, '\\'));
      expect(key).toMatch(pattern);
    }
  );

  it('rejects a key belonging to a different job — the cross-job guard', () => {
    const jobId = '3f6c1a2e-8b7d-4c5e-9a0f-1d2e3b4c5d6e';
    const other  = '00000000-0000-0000-0000-000000000000';
    const pattern = new RegExp('^jobs/' + jobId + tail![1].replace(/\\\\/g, '\\'));

    expect(`jobs/${other}/1755740000000.jpg`).not.toMatch(pattern);
    expect(`jobs/${jobId}/../${other}/1.jpg`).not.toMatch(pattern);
    expect(`jobs/${jobId}/1.svg`).not.toMatch(pattern);
  });
});
