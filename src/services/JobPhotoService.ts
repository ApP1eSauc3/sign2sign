import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from './supabaseClient';

// Max dimension for either axis — keeps uploads under ~500KB on most devices
const MAX_PHOTO_DIMENSION = 1600;

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

    // Resize before returning — reduces upload size from 4–12MB to ~300–600KB
    // on a typical phone camera without visible quality loss at sign-photo scale
    const needsResize =
      asset.width > MAX_PHOTO_DIMENSION || asset.height > MAX_PHOTO_DIMENSION;

    if (needsResize) {
      const isLandscape = asset.width >= asset.height;
      const resized = await ImageManipulator.manipulateAsync(
        asset.uri,
        [
          isLandscape
            ? { resize: { width: MAX_PHOTO_DIMENSION } }
            : { resize: { height: MAX_PHOTO_DIMENSION } },
        ],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );
      return resized.uri;
    }

    return asset.uri;
  },

  // Upload photo to Supabase Storage and update the job record.
  // GPS location is passed in by the store at call time — not read here.
  async uploadPhoto(
    jobId: string,
    imageUri: string,
    currentLocation: PhotoLocation
  ): Promise<PhotoUploadResult> {
    const timestamp = new Date();
    const ext = imageUri.split('.').pop() ?? 'jpg';
    const key = `jobs/${jobId}/${timestamp.getTime()}.${ext}`;

    // Fetch the image as a blob
    const response = await fetch(imageUri);
    const blob = await response.blob();

    const { error: uploadError } = await supabase.storage
      .from('job-photos')
      .upload(key, blob, { contentType: `image/${ext}`, upsert: false });

    if (uploadError) throw new Error(uploadError.message);

    // Update the job record — key only, never the signed URL
    const { error: updateError } = await supabase
      .from('jobs')
      .update({
        photo_key: key,
        photo_gps_lat: currentLocation.latitude,
        photo_gps_lng: currentLocation.longitude,
        photo_timestamp: timestamp.toISOString(),
      })
      .eq('id', jobId);

    if (updateError) {
      // P0002 = photo_key write-once trigger: an earlier upload attempt reached the
      // DB but the client never received the response (network failure mid-request).
      // The photo is already on record — fetch the canonical key and return success
      // rather than surfacing a spurious error to the driver.
      if (updateError.code === 'P0002') {
        const { data: existing } = await supabase
          .from('jobs')
          .select('photo_key, photo_gps_lat, photo_gps_lng, photo_timestamp')
          .eq('id', jobId)
          .single();
        if (existing?.photo_key) {
          return {
            photoKey: existing.photo_key,
            latitude: existing.photo_gps_lat ?? currentLocation.latitude,
            longitude: existing.photo_gps_lng ?? currentLocation.longitude,
            timestamp: existing.photo_timestamp ? new Date(existing.photo_timestamp) : timestamp,
          };
        }
      }
      throw new Error(updateError.message);
    }

    return {
      photoKey: key,
      latitude: currentLocation.latitude,
      longitude: currentLocation.longitude,
      timestamp,
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

    const result = data as { ok?: boolean; error?: string; already_complete?: boolean };
    if (result?.error) throw new Error(result.error);
  },
};
