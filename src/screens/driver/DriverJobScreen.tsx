import { useState, useEffect, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
  Linking,
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

type Props = NativeStackScreenProps<DriverStackParamList, 'DriverJob'>;

export default function DriverJobScreen({ route, navigation }: Props) {
  const { jobId } = route.params;
  const insets = useSafeAreaInsets();

  const { getJob, uploadStates, markCompleteErrors, canMarkComplete, capturePhoto, confirmAndUpload, retakePhoto, markComplete, handleLocationDenied } =
    useDriverSession();

  const job = getJob(jobId);
  const uploadState: JobUploadState = uploadStates[jobId] ?? { status: 'idle' };
  const markCompleteError = markCompleteErrors[jobId] ?? '';

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
    if (uploadState.status === 'succeeded' && canMarkComplete(jobId)) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);  // DESIGN §4 — mark complete
      setIsMarkingComplete(true);
      const success = await markComplete(jobId);
      setIsMarkingComplete(false);
      if (success) {
        promptCompletionEmail(job!);
        navigation.goBack();
      }
    }
  }

  const button = getButtonState(uploadState, job.isComplete, isMarkingComplete);

  function promptCompletionEmail(completedJob: typeof job) {
    if (!completedJob?.agentEmail) return;
    // agent_email originates from the Google Sheet (semi-trusted admin data).
    // Validate strictly before putting it in a mailto: URL — a value with a
    // '?' / '&' / CRLF could inject extra mailto headers (cc/bcc) and silently
    // leak the completion notice to an attacker-controlled address.
    const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!EMAIL_RE.test(completedJob.agentEmail)) {
      Alert.alert(
        'Agent email looks invalid',
        'The agent email on this job is malformed, so no notice was sent. Check it in the admin route detail screen.'
      );
      return;
    }
    Alert.alert(
      'Notify Agent?',
      `Send a completion notice to ${completedJob.agentName ?? completedJob.agentEmail}?`,
      [
        { text: 'Skip', style: 'cancel' },
        {
          text: 'Send Email',
          onPress: () => {
            const subject = encodeURIComponent(
              `Sign ${completedJob.jobType === 'install' ? 'installed' : 'removed'} — ${completedJob.address}`
            );
            const body = encodeURIComponent(
              `Hi ${completedJob.agentName ?? ''},\n\n` +
              `This is to confirm that the sign ${completedJob.jobType === 'install' ? 'installation' : 'removal'} at:\n\n` +
              `${completedJob.address}\n\n` +
              `has been completed by the Sign2Sign crew.\n\n` +
              `Client: ${completedJob.clientName}\n` +
              `Sign: ${completedJob.signDescription}\n\n` +
              `Regards,\nSign2Sign`
            );
            Linking.openURL(
              `mailto:${completedJob.agentEmail}?subject=${subject}&body=${body}`
            );
          },
        },
      ]
    );
  }

  const typeColor = job.jobType === 'install' ? colors.install : colors.removal;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Nav bar */}
      <View style={styles.nav}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.navBack}>← Route</Text>
        </TouchableOpacity>
        <View style={[styles.typePill, { borderColor: typeColor }]}>
          <Text style={[styles.typePillText, { color: typeColor }]}>
            {job.jobType.toUpperCase()}
          </Text>
        </View>
      </View>

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
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: button.color }]}
            onPress={handlePrimaryAction}
            disabled={!button.enabled}
            activeOpacity={0.85}
          >
            {button.loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.actionButtonText}>{button.label}</Text>
            )}
          </TouchableOpacity>
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

// ─── Exhaustiveness helper ────────────────────────────────────────────────────

function assertNever(x: never): never {
  throw new Error(`Unhandled upload state: ${JSON.stringify(x)}`);
}

// ─── Advancing button state ──────────────────────────────────────────────────

function getButtonState(
  state: JobUploadState,
  isComplete: boolean,
  isMarkingComplete: boolean
): { label: string; color: string; enabled: boolean; loading: boolean } {
  if (isComplete) {
    return { label: '✓ Complete', color: colors.statusCompleteBg, enabled: false, loading: false };
  }
  switch (state.status) {
    case 'idle':
      return { label: 'Take Photo', color: colors.brand, enabled: true, loading: false };
    case 'capturing':
      return { label: 'Opening Camera…', color: colors.brandPressed, enabled: false, loading: true };
    case 'preview':
      return { label: 'Upload Photo', color: colors.brand, enabled: true, loading: false };
    case 'uploading':
      return { label: 'Uploading…', color: colors.brandPressed, enabled: false, loading: true };
    case 'succeeded':
      return {
        label: isMarkingComplete ? 'Marking Complete…' : 'Mark Complete',
        color: colors.statusComplete,
        enabled: !isMarkingComplete,
        loading: isMarkingComplete,
      };
    case 'failed':
      return { label: 'Retry Photo', color: colors.statusFailed, enabled: true, loading: false };
    default:
      return assertNever(state);
  }
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

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,  // DESIGN §2.4 — standard page margin
    paddingVertical: 12,    // DESIGN §1.3 — on-grid
  },
  navBack: {
    fontSize: 15,
    color: colors.brand,
    fontWeight: '600',
  },
  typePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  typePillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },

  typeStripe: {
    height: 4,
    width: '100%',
  },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 24 },  // DESIGN §2.4 — standard page margin

  address: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 34,
    marginBottom: 24,
  },

  detailsCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,         // DESIGN §1.6 — standard card
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    paddingVertical: 12,      // DESIGN §1.3 — on-grid
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailLabel: {
    width: 70,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  detailValue: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
  },

  sectionLabel: {
    fontSize: 11,             // DESIGN §1.7 — micro label
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 1.2,
    marginBottom: 8,          // DESIGN §1.3 — on-grid
  },

  photoCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,         // DESIGN §1.6 — standard card
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  photoThumb: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: colors.border,
  },
  photoMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 8,
    fontVariant: ['tabular-nums'],
  },

  retakeButton: {
    marginTop: 12,            // DESIGN §1.3 — on-grid
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  retakeButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  errorBox: {
    backgroundColor: colors.statusFailedBg,
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    color: colors.statusFailed,
    fontSize: 14,
    fontWeight: '500',
  },

  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,  // DESIGN §2.4 — standard page margin
    paddingTop: 12,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: {
    height: 64,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.white,
  },
  completeTag: {
    backgroundColor: colors.statusCompleteBg,
  },
  completeTagText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.statusComplete,
  },
});
