import { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import MapView, { Marker, Polyline, Callout } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DriverStackParamList } from '../../navigation/DriverStack';
import { useDriverSession } from '../../stores/useDriverSession';
import { useAppStore } from '../../stores/useAppStore';
import { AppMode, SignJob, JobUploadState } from '../../data/SignJob';
import { colors } from '../../utils/colors';
import { RouteService, LatLng } from '../../services/RouteService';
import { OfflineBanner } from '../OfflineBanner';

type Props = NativeStackScreenProps<DriverStackParamList, 'DriverMap'>;

export default function DriverMapScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  const { session, uploadStates, completedCount, clearSession } = useDriverSession();
  const setMode = useAppStore((s) => s.setMode);

  const [polylineCoords, setPolylineCoords] = useState<LatLng[]>([]);
  const [orderedJobIds, setOrderedJobIds] = useState<string[]>([]);
  const [routeLoading, setRouteLoading] = useState(true);

  const jobs = session?.jobs ?? [];
  const done = completedCount();
  const total = jobs.length;
  const allComplete = total > 0 && done === total;

  useEffect(() => {
    if (jobs.length === 0) {
      setRouteLoading(false);
      return;
    }
    RouteService.computeRoute(jobs).then((result) => {
      setOrderedJobIds(result.orderedJobs.map(j => j.id));
      setPolylineCoords(result.polylineCoords);
      setRouteLoading(false);
    });
  }, []); // runs once — jobs are fully loaded when this screen mounts

  function fitToJobs() {
    if (jobs.length === 0) return;
    mapRef.current?.fitToCoordinates(
      jobs.map(j => ({ latitude: j.latitude, longitude: j.longitude })),
      { edgePadding: { top: 120, right: 40, bottom: 80, left: 40 }, animated: true }
    );
  }

  function handleExit() {
    const incomplete = jobs.filter(j => !j.isComplete).length;
    if (incomplete > 0) {
      Alert.alert(
        'Exit Route?',
        `${incomplete} job${incomplete === 1 ? '' : 's'} still in progress. Your progress is saved — re-enter your code to continue.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Exit',
            style: 'destructive',
            onPress: () => { clearSession(); setMode(AppMode.Undecided); },
          },
        ]
      );
      return;
    }
    clearSession();
    setMode(AppMode.Undecided);
  }

  if (!session) return null;

  // Always look up jobs from the live store so pin state stays fresh after completions.
  // orderedJobIds gives the optimized sequence; each id maps to the current job object.
  const displayJobs = orderedJobIds.length > 0
    ? orderedJobIds.map(id => jobs.find(j => j.id === id)).filter((j): j is SignJob => j !== undefined)
    : [...jobs].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <View style={styles.root}>
      {/* Full-screen map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        userInterfaceStyle="dark"
        showsUserLocation
        showsMyLocationButton={false}
        onMapReady={fitToJobs}
      >
        {/* Route polyline — real road geometry if API key set, straight-line fallback */}
        {polylineCoords.length > 1 && (
          <Polyline
            coordinates={polylineCoords}
            strokeColor={colors.brand}
            strokeWidth={3}
          />
        )}

        {/* Job pins — numbered in route order */}
        {displayJobs.map((job, index) => {
          const uploadState = uploadStates[job.id];
          return (
            <Marker
              // Key includes upload status so the pin re-renders when the job completes
              key={`${job.id}-${job.isComplete}-${uploadState?.status ?? 'idle'}`}
              coordinate={{ latitude: job.latitude, longitude: job.longitude }}
              tracksViewChanges={false}
              onCalloutPress={() => navigation.navigate('DriverJob', { jobId: job.id })}
            >
              <JobPin job={job} routeIndex={index + 1} />
              <Callout tooltip onPress={() => navigation.navigate('DriverJob', { jobId: job.id })}>
                <JobCallout job={job} uploadState={uploadState} />
              </Callout>
            </Marker>
          );
        })}
      </MapView>

      {/* Top overlay — floats above the map; contains controls + offline banner */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        {/* Control row */}
        <View style={styles.topBarRow}>
          <TouchableOpacity
            style={styles.overlayButton}
            onPress={handleExit}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.overlayButtonText}>← Exit</Text>
          </TouchableOpacity>

          <View style={[styles.progressPill, allComplete && styles.progressPillComplete]}>
            {routeLoading ? (
              <ActivityIndicator size="small" color={colors.brand} />
            ) : (
              <Text style={[styles.progressText, allComplete && styles.progressTextComplete]}>
                {allComplete ? '✓ Route Complete' : `${done} / ${total} complete`}
              </Text>
            )}
          </View>

          <TouchableOpacity
            style={styles.overlayButton}
            onPress={() => navigation.navigate('DriverRoute')}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.overlayButtonText}>≡ List</Text>
          </TouchableOpacity>
        </View>

        {/* Offline banner sits below the controls row inside the overlay */}
        <OfflineBanner />
      </View>
    </View>
  );
}

// ─── Job pin marker ───────────────────────────────────────────────────────────

function JobPin({ job, routeIndex }: { job: SignJob; routeIndex: number }) {
  const pinColor = job.isComplete
    ? colors.textDisabled
    : job.jobType === 'install'
    ? colors.install
    : colors.removal;

  return (
    <View style={styles.pinContainer}>
      <View
        style={[
          styles.pinCircle,
          { backgroundColor: pinColor },
          job.isComplete && styles.pinComplete,
        ]}
      >
        <Text style={styles.pinText}>
          {job.isComplete ? '✓' : String(routeIndex)}
        </Text>
      </View>
      {/* Downward triangle pointer */}
      <View style={[styles.pinPointer, { borderTopColor: pinColor }]} />
    </View>
  );
}

// ─── Callout card ─────────────────────────────────────────────────────────────

function JobCallout({
  job,
  uploadState,
}: {
  job: SignJob;
  uploadState?: JobUploadState;
}) {
  const typeColor = job.jobType === 'install' ? colors.install : colors.removal;

  const statusLabel = job.isComplete
    ? 'COMPLETE'
    : uploadState?.status === 'succeeded'
    ? 'PHOTO DONE'
    : uploadState?.status === 'failed'
    ? 'PHOTO FAILED'
    : 'PENDING';

  const statusColor = job.isComplete || uploadState?.status === 'succeeded'
    ? colors.statusComplete
    : uploadState?.status === 'failed'
    ? colors.statusFailed
    : colors.statusPending;

  return (
    <View style={styles.callout}>
      {/* Type + status badges */}
      <View style={styles.calloutBadgeRow}>
        <View style={[styles.calloutBadge, { borderColor: typeColor }]}>
          <Text style={[styles.calloutBadgeText, { color: typeColor }]}>
            {job.jobType.toUpperCase()}
          </Text>
        </View>
        <View style={[styles.calloutBadge, { borderColor: statusColor, marginLeft: 6 }]}>
          <Text style={[styles.calloutBadgeText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      {/* Address */}
      <Text style={styles.calloutAddress}>{job.address}</Text>

      {/* Client · Agent */}
      <Text style={styles.calloutMeta}>
        {job.clientName}
        {job.agentName ? `  ·  ${job.agentName}` : ''}
      </Text>

      {/* CTA */}
      <Text style={styles.calloutCta}>Open job →</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  // Top floating bar
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15, 17, 23, 0.88)',  // colors.bg at ~88% opacity
    paddingBottom: 4,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,    // DESIGN §2.4 — standard page margin
    paddingBottom: 12,
  },
  overlayButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,           // DESIGN §1.6 — input field radius
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 40,             // DESIGN §3.4 — icon-button minimum
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayButtonText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  progressPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 99,          // DESIGN §1.6 — capsule badge
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 110,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressPillComplete: {
    borderColor: colors.statusComplete,
    backgroundColor: colors.statusCompleteBg,
  },
  progressText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  progressTextComplete: {
    color: colors.statusComplete,
  },

  // Map pin
  pinContainer: { alignItems: 'center' },
  pinCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 4,
  },
  pinComplete: { opacity: 0.45 },
  pinText: {
    color: colors.bg,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 14,
  },
  pinPointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
  },

  // Callout card
  callout: {
    backgroundColor: colors.surface,
    borderRadius: 10,         // DESIGN §1.6 — standard card
    padding: 14,
    minWidth: 210,
    maxWidth: 270,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  calloutBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  calloutBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
    borderWidth: 1,
  },
  calloutBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  calloutAddress: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 20,
    marginBottom: 4,
  },
  calloutMeta: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  calloutCta: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.brand,
  },
});
