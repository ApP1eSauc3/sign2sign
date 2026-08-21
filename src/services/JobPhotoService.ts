import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from './supabaseClient';

// Max dimension for either axis — keeps uploads under ~500KB on most devices
const MAX_PHOTO_DIMENSION = 1600;

// Whitelist of allowed image extensions → canonical MIME type. The upload key
// and Content-Type are derived from the camera URI, which can carry query
// strings or unexpected suffixes; never feed an unsanitised extension into
// the storage key or `image/${ext}` Content-Type header.
const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function sanitizeExtension(imageUri: string): { ext: string; contentType: string } {
  // Strip query/fragment, take the last path segment's extension, lowercase it.
  const clean = imageUri.split(/[?#]/)[0];
  const raw = (clean.split('.').pop() ?? '').toLowerCase();
  const ext = raw === 'jpeg' ? 'jpg' : raw;
  const contentType = EXT_TO_MIME[raw];
  // Default to jpeg — capturePhoto re-encodes to JPEG on resize, and the
  // storage bucket only accepts the whitelisted MIME types anyway.
  if (!contentType) return { ext: 'jpg', contentType: 'image/jpeg' };
  return { ext, contentType };
}

// record_job_photo() returns machine-readable error codes (migration 013).
// Translate at the boundary — a driver in a paddock cannot act on
// "invalid_route_code", and the raw string must never reach the UI.
const RECORD_PHOTO_ERRORS: Record<string, string> = {
  invalid_route_code:
    'Your route code is no longer valid. Tell dispatch which jobs you finished so they can record them.',
  job_not_found: 'That job is not on your route any more. Check with dispatch.',
  invalid_photo_key: 'Something went wrong saving that photo. Take it again.',
  invalid_location:
    'Your location could not be recorded accurately. Check that Location Services is on, then retry.',
};

export type PhotoLocation = {
  latitude: number;
  longitude: number;
};

export type PhotoUploadResult = {
  photoKey: string;
  latitude: number;
  longitude: number;
  timestamp: Date;
};

export const JobPhotoService = {
  // Request camera permission and open camera.
  // Throws if permission is denied (caller can surface the error message).
  // Returns null if the user cancels without taking a photo (not an error).
  async capturePhoto(): Promise<string | null> {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Camera access is required to take job photos. Enable it in Settings.');
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets[0]) return null;

    const asset = result.assets[0];

    // Always re-encode, even when no resize is needed.
    //
    // Two jobs, one call. (1) Resizing cuts a 4–12MB camera frame to
    // ~300–600KB with no visible loss at sign-photo scale. (2) Re-encoding
    // drops the EXIF block, which on a camera capture carries the phone's
    // own GPS fix. This app records location deliberately, in its own
    // columns, captured at upload time — an unmanaged second copy riding
    // inside the stored file is exposure we get nothing for.
    //
    // Previously the re-encode sat behind a needsResize check, so any photo
    // already within MAX_PHOTO_DIMENSION uploaded as the raw camera asset
    // with its EXIF intact.
    const needsResize =
      asset.width > MAX_PHOTO_DIMENSION || asset.height > MAX_PHOTO_DIMENSION;
    const isLandscape = asset.width >= asset.height;

    const actions: ImageManipulator.Action[] = needsResize
      ? [
          isLandscape
            ? { resize: { width: MAX_PHOTO_DIMENSION } }
            : { resize: { height: MAX_PHOTO_DIMENSION } },
        ]
      : [];

    // An empty action list still re-encodes — that is the metadata strip.
    const processed = await ImageManipulator.manipulateAsync(asset.uri, actions, {
      compress: 0.8,
      format: ImageManipulator.SaveFormat.JPEG,
    });

    return processed.uri;
  },

  // Upload photo to Supabase Storage, then record it against the job via the
  // record_job_photo() RPC (migration 013).
  //
  // GPS location is passed in by the store at call time — not read here.
  // routeCode authorizes the write: the RPC checks the code is active (within
  // the 24h offline-sync grace window) and that it owns the target job.
  //
  // Why an RPC and not a direct UPDATE: migration 006 revoked anon's SELECT on
  // `jobs` without re-granting a column subset, and PostgREST's
  // `.update(...).eq('id', jobId)` needs SELECT on `jobs.id` to evaluate its
  // WHERE clause. The statement was refused at the privilege layer before RLS
  // was consulted, which is why driver photo upload was dead in production.
  // 013 moves the write behind a SECURITY DEFINER function and removes anon's
  // direct write access to the table entirely. See the migration header.
  async uploadPhoto(
    jobId: string,
    imageUri: string,
    currentLocation: PhotoLocation,
    routeCode: string
  ): Promise<PhotoUploadResult> {
    const timestamp = new Date();
    const { ext, contentType } = sanitizeExtension(imageUri);
    const key = `jobs/${jobId}/${timestamp.getTime()}.${ext}`;

    // Fetch the image as a blob
    const response = await fetch(imageUri);
    const blob = await response.blob();

    const { error: uploadError } = await supabase.storage
      .from('job-photos')
      .upload(key, blob, { contentType, upsert: false });

    if (uploadError) throw new Error(uploadError.message);

    // Record the key against the job — key only, never the signed URL.
    const { data, error } = await supabase.rpc('record_job_photo', {
      p_job_id: jobId,
      p_route_code: routeCode,
      p_photo_key: key,
      p_lat: currentLocation.latitude,
      p_lng: currentLocation.longitude,
      p_timestamp: timestamp.toISOString(),
    });

    if (error) throw new Error(error.message);

    // Narrow the RPC payload at the boundary — `data` is typed as unknown.
    if (data === null || typeof data !== 'object') {
      throw new Error('Unexpected response while recording the photo.');
    }

    const result = data as {
      ok?: boolean;
      error?: string;
      already_recorded?: boolean;
      photo_key?: string;
      photo_gps_lat?: number | null;
      photo_gps_lng?: number | null;
      photo_timestamp?: string | null;
    };

    if (typeof result.error === 'string' && result.error.length > 0) {
      throw new Error(RECORD_PHOTO_ERRORS[result.error] ?? result.error);
    }

    // already_recorded means an earlier attempt reached the database but the
    // client never saw the response (network failure mid-request). The photo is
    // on record and photo_key is write-once, so the stored values — not the ones
    // we just generated — are the truth. This replaces the old two-round-trip
    // P0002 + recover_existing_photo() dance; the RPC returns them inline.
    if (typeof result.photo_key !== 'string') {
      throw new Error('Unexpected response while recording the photo.');
    }

    return {
      photoKey: result.photo_key,
      latitude: result.photo_gps_lat ?? currentLocation.latitude,
      longitude: result.photo_gps_lng ?? currentLocation.longitude,
      timestamp: result.photo_timestamp ? new Date(result.photo_timestamp) : timestamp,
    };
  },

  // Generate a signed URL for display — call at render time, never store the result
  async getSignedUrl(photoKey: string): Promise<string | null> {
    const { data } = await supabase.storage
      .from('job-photos')
      .createSignedUrl(photoKey, 3600);
    return data?.signedUrl ?? null;
  },

  // Mark a job complete via the atomic complete_job() RPC.
  // The RPC acquires a FOR UPDATE row lock — concurrent calls for the same job
  // serialize cleanly, and an already-complete job returns success (idempotent).
  async markJobComplete(jobId: string, routeCode: string): Promise<void> {
    const { data, error } = await supabase.rpc('complete_job', {
      p_job_id: jobId,
      p_route_code: routeCode,
    });

    if (error) throw new Error(error.message);

    // Narrow the RPC payload at the boundary — `data` is typed as unknown.
    if (data !== null && typeof data === 'object') {
      const result = data as { ok?: boolean; error?: string; already_complete?: boolean };
      if (typeof result.error === 'string' && result.error.length > 0) {
        throw new Error(result.error);
      }
    }
  },
};
