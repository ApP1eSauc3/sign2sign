import { useState, useEffect, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DriverStackParamList } from '../../navigation/DriverStack';
import { useDriverSession } from '../../stores/useDriverSession';
import { JobPhotoService } from '../../services/JobPhotoService';
import { colors } from '../../utils/colors';
import { OfflineBanner } from '../OfflineBanner';
import { JobUploadState } from '../../data/SignJob';
import { ScreenHeader } from '../components/ScreenHeader';
import { TypePill } from '../components/TypePill';
import { AdvancingActionButton } from '../components/AdvancingActionButton';
import { styles } from './job/styles';

type Props = NativeStackScreenProps<DriverStackParamList, 'DriverJob'>;

// Module-level so the identity is stable. Allocating this inline would defeat
// the Object.is comparison the selectors below rely on.
const IDLE_UPLOAD_STATE: JobUploadState = { status: 'idle' };

export default function DriverJobScreen({ route, navigation }: Props) {
  const { jobId } = route.params;
  const insets = useSafeAreaInsets();

  // Subscribe to THIS job's slice only. Previously this screen took the whole
  // store, so a background offline-queue flush touching any other job on the
  // route re-rendered the job the driver was actually looking at.
  //
  // Note the defaults are applied OUTSIDE the selector, deliberately. Zustand v5
  // compares selector output with Object.is, so a selector ending in
  // `?? { status: 'idle' }` would return a freshly-allocated object on every
  // call, never compare equal, and re-render forever.
  const job = useDriverSession((s) => s.getJob(jobId));
  const rawUploadState = useDriverSession((s) => s.uploadStates[jobId]);
  const rawMarkCompleteError = useDriverSession((s) => s.markCompleteErrors[jobId]);

  const uploadState: JobUploadState = rawUploadState ?? IDLE_UPLOAD_STATE;
  const markCompleteError = rawMarkCompleteError ?? '';

  // The photo gate. Read as a boolean from the store — the rule itself lives in
  // useDriverSession.canMarkComplete and must never be re-derived in a screen.
  const photoGateOpen = useDriverSession((s) => s.canMarkComplete(jobId));

  const capturePhoto = useDriverSession((s) => s.capturePhoto);
  const confirmAndUpload = useDriverSession((s) => s.confirmAndUpload);
  const retakePhoto = useDriverSession((s) => s.retakePhoto);
  const markComplete = useDriverSession((s) => s.markComplete);
  const handleLocationDenied = useDriverSession((s) => s.handleLocationDenied);

  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isMarkingComplete, setIsMarkingComplete] = useState(false);

  // Load signed URL when photo is available from storage — async with cancellation
  useEffect(() => {
    let cancelled = false;
    const photoKey =
      uploadState.status === 'succeeded' ? uploadState.photoKey : job?.photoKey;
    if (!photoKey) {
      setSignedUrl(null);
      return;
    }

    JobPhotoService.getSignedUrl(photoKey).then((url) => {
      if (!cancelled) setSignedUrl(url);
    });
    return () => { cancelled = true; };
  }, [uploadState.status, job?.photoKey]);

  // Haptic feedback on upload state transitions
  const prevUploadStatus = useRef(uploadState.status);
  useEffect(() => {
    const prev = prevUploadStatus.current;
    const next = uploadState.status;
    prevUploadStatus.current = next;
    if (prev === 'uploading' && next === 'succeeded') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (prev === 'uploading' && next === 'failed') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [uploadState.status]);

  if (!job) return null;

  // ─── Advancing action button logic ─────────────────────────────────────

  async function handlePrimaryAction() {
    if (isMarkingComplete) return;   // guard: double-tap prevention
    if (job!.isComplete) return;

    // Step 1: Capture — open camera, stop at preview
    if (uploadState.status === 'idle' || uploadState.status === 'failed') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);  // DESIGN §4 — primary CTA
      await capturePhoto(jobId);
      return;
    }

    // Step 2: Confirm — request GPS now, then upload the previewed photo
    if (uploadState.status === 'preview') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);  // DESIGN §4 — confirm upload
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        handleLocationDenied(jobId);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await confirmAndUpload(jobId, {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      return;
    }

    // Step 3: Mark complete — only reachable when canMarkComplete is true
    if (uploadState.status === 'succeeded' && photoGateOpen) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);  // DESIGN §4 — mark complete
      setIsMarkingComplete(true);
      const success = await markComplete(jobId);
      setIsMarkingComplete(false);
      if (success) {
        // No completion email from here. The driver never contacts the client:
        // the notice is a claim made on Sign2Sign's behalf and an admin
        // approves and sends it from the business account. This screen used to
        // open a mailto: from the driver's own mail app — see migration 015.
        navigation.goBack();
      }
    }
  }

  const typeColor = job.jobType === 'install' ? colors.install : colors.removal;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Nav bar */}
      <ScreenHeader
        variant="driver"
        backLabel="Route"
        onBack={() => navigation.goBack()}
        trailing={<TypePill jobType={job.jobType} />}
        divider={false}
      />

      <OfflineBanner />

      {/* Job type stripe */}
      <View style={[styles.typeStripe, { backgroundColor: typeColor }]} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
      >
        {/* Address hero */}
        <Text style={styles.address}>{job.address}</Text>

        {/* Details grid */}
        <View style={styles.detailsCard}>
          <DetailRow label="Client" value={job.clientName} />
          {job.agentName ? <DetailRow label="Agent" value={job.agentName} /> : null}
          {job.agentEmail ? <DetailRow label="Email" value={job.agentEmail} /> : null}
          <DetailRow label="Sign" value={job.signDescription} />
        </View>

        {/* Preview card — local image awaiting upload confirmation */}
        {uploadState.status === 'preview' && (
          <View style={styles.photoCard}>
            <Text style={styles.sectionLabel}>REVIEW PHOTO</Text>
            <Image source={{ uri: uploadState.imageUri }} style={styles.photoThumb} resizeMode="cover" />
            <TouchableOpacity
              style={styles.retakeButton}
              onPress={() => retakePhoto(jobId)}
              activeOpacity={0.8}
            >
              <Text style={styles.retakeButtonText}>Retake</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Confirmed photo — signed URL from storage */}
        {signedUrl && uploadState.status !== 'preview' && (
          <View style={styles.photoCard}>
            <Text style={styles.sectionLabel}>PHOTO CAPTURED</Text>
            <Image source={{ uri: signedUrl }} style={styles.photoThumb} resizeMode="cover" />
            {job.photoTimestamp && (
              <Text style={styles.photoMeta}>
                {new Date(job.photoTimestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {job.photoGPSLat
                  ? `  ·  ${job.photoGPSLat.toFixed(5)}, ${job.photoGPSLng?.toFixed(5)}`
                  : ''}
              </Text>
            )}
          </View>
        )}

        {/* Upload failure — photo needs to be retaken */}
        {uploadState.status === 'failed' && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{uploadState.message}</Text>
          </View>
        )}

        {/* Mark-complete failure — photo is already uploaded, only the DB write failed */}
        {uploadState.status === 'succeeded' && markCompleteError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{markCompleteError}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Advancing action button — fixed at bottom */}
      {!job.isComplete && (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 16 }]}>
          <AdvancingActionButton
            uploadState={uploadState}
            isComplete={job.isComplete}
            isMarkingComplete={isMarkingComplete}
            onPress={handlePrimaryAction}
          />
        </View>
      )}

      {job.isComplete && (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 16 }]}>
          <View style={[styles.actionButton, styles.completeTag]}>
            <Text style={styles.completeTagText}>✓ Job Complete</Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}
