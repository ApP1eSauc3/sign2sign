import { useRef, useEffect, useState, useMemo, memo } from 'react';
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
import { RouteService, LatLng, RouteResult } from '../../services/RouteService';
import { OfflineBanner } from '../OfflineBanner';
import { orderJobsForDisplay } from './mapOrder.logic';

type Props = NativeStackScreenProps<DriverStackParamList, 'DriverMap'>;

// Stable identity for the no-session case. `session?.jobs ?? []` would allocate
// a fresh array on every render and invalidate the memo below every time.
const NO_JOBS: SignJob[] = [];

// What the driver is told when the route came back as the straight-line
// fallback. RouteService reports WHY; the wording differs because the fix does.
const DEGRADED_MESSAGE: Record<NonNullable<RouteResult['degradedReason']>, string> = {
  'too-many-waypoints': 'Too many stops to optimise — pins follow your list order.',
  'no-api-key': 'Route optimisation is off — pins follow your list order.',
  'request-failed': "Couldn't optimise the route — pins follow your list order.",
  'bad-response': "Couldn't optimise the route — pins follow your list order.",
};

export default function DriverMapScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  // Atomic selectors — see the note in src/stores/CLAUDE.md. Subscribing to the
  // whole store re-rendered this screen on every per-job upload transition.
  const session = useDriverSession((s) => s.session);
  const uploadStates = useDriverSession((s) => s.uploadStates);
  const completedCount = useDriverSession((s) => s.completedCount);
  const clearSession = useDriverSession((s) => s.clearSession);
  const setMode = useAppStore((s) => s.setMode);

  const [polylineCoords, setPolylineCoords] = useState<LatLng[]>([]);
  const [orderedJobIds, setOrderedJobIds] = useState<string[]>([]);
  const [routeLoading, setRouteLoading] = useState(true);
  const [degradedReason, setDegradedReason] =
    useState<RouteResult['degradedReason'] | null>(null);

  const jobs = session?.jobs ?? NO_JOBS;
  const done = completedCount();
  const total = jobs.length;
  const allComplete = total > 0 && done === total;

  // The route code is the credential optimize-route checks before spending a
  // billable request. Read here and passed in, because services never read
  // stores — the same rule that makes photo upload take `currentLocation` as
  // a parameter.
  const routeCode = session?.routeCode ?? '';

  useEffect(() => {
    if (jobs.length === 0 || !routeCode) {
      setRouteLoading(false);
      return;
    }
    let cancelled = false;
    RouteService.computeRoute(jobs, routeCode).then((result) => {
      if (cancelled) return;   // screen left before the route came back
      setOrderedJobIds(result.orderedJobs.map(j => j.id));
      setPolylineCoords(result.polylineCoords);
      // A straight-line fallback must not be presented as a real driving route.
      setDegradedReason(result.degraded ? result.degradedReason ?? 'request-failed' : null);
      setRouteLoading(false);
    });
    return () => { cancelled = true; };
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

  // Always look up jobs from the live store so pin state stays fresh after
  // completions. orderedJobIds gives the optimized sequence; each id maps to the
  // current job object.
  //
  // This was `orderedJobIds.map(id => jobs.find(...))` — a linear scan inside a
  // map, so O(n²), recomputed on every render. Building the index once makes it
  // O(n), and the memo stops it running at all unless the route order or the
  // jobs themselves changed. `jobs` is a stable reference straight off the store
  // (see NO_JOBS), so this does not re-run on unrelated state changes.
  const displayJobs = useMemo(
    () => orderJobsForDisplay(jobs, orderedJobIds),
    [orderedJobIds, jobs]
  );

  // Every hook must run before this, on every render — including the ones above.
  if (!session) return null;

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
              // The key carries exactly what JobPin PAINTS: the completion
              // tick, and the route number.
              //
              // Changing a key does not re-render a component, it destroys and
              // recreates it — on react-native-maps a native view teardown —
              // so it is scoped as tightly as possible. It is needed at all
              // because `tracksViewChanges={false}` tells the native marker to
              // snapshot its custom view once and stop observing, so an
              // ordinary prop change repaints nothing.
              //
              // `routeIndex` MUST be in here. The screen mounts and paints the
              // pins in sort_order while computeRoute is still in flight; when
              // the optimised route answers a second later, displayJobs reorders and
              // every pin's number changes. Without the index in the key those
              // numbers are frozen at the pre-optimisation order — the polyline
              // would show the optimised route while the pins counted in sheet
              // order, and each would only correct itself when that job
              // completed. Including it costs exactly one remount per marker,
              // when the optimised order arrives, which is the repaint we want.
              //
              // `uploadState.status` is deliberately NOT here. It used to be,
              // so every capture → preview → uploading → succeeded transition
              // tore down and rebuilt a native marker — and JobPin never
              // renders upload state, so those remounts repainted nothing. The
              // callout does show it, but it is a separate view rendered on tap
              // and updates normally.
              key={`${job.id}-${job.isComplete}-${index + 1}`}
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

        {/*
          Route-degraded notice. The pins are numbered, so without this a driver
          reads the sequence as an optimised run and trusts it. Amber
          (statusProgress) is the advisory token already used by OfflineBanner —
          this is information, not a failure, and nothing is broken.

          The ⚠ carries the meaning alongside the colour rather than relying on
          hue alone, and the strip is non-interactive, so no touch target
          applies. Wording names the consequence ("pins follow your list order")
          rather than the cause — a driver cannot act on "waypoint cap".
        */}
        {!routeLoading && degradedReason && (
          <View style={styles.degradedBanner} pointerEvents="none" accessible>
            <Text style={styles.degradedText}>
              {`⚠  ${DEGRADED_MESSAGE[degradedReason]}`}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Job pin marker ───────────────────────────────────────────────────────────

// Memoised: a route of n jobs renders n pins, and without this every one of
// them re-renders whenever any single job's state changes. Props are a job
// object (stable reference from the store) and a number, so the default
// shallow compare is exactly right.
const JobPin = memo(function JobPin({ job, routeIndex }: { job: SignJob; routeIndex: number }) {
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
});

// ─── Callout card ─────────────────────────────────────────────────────────────

const JobCallout = memo(function JobCallout({
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
});

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Route-degraded advisory. Same strip language as OfflineBanner so the two
  // read as one family when both are showing. Amber on dark amber:
  // statusProgress is documented as the max-peripheral-visibility, CVD-safe
  // token — the right choice for something glanced at in sunlight.
  degradedBanner: {
    backgroundColor: colors.statusProgressBg,
    paddingHorizontal: 16,   // DESIGN §2.4 — standard page margin
    paddingVertical: 12,     // spacing grid
    borderTopWidth: 1,
    borderTopColor: colors.statusProgress,
  },
  degradedText: {
    color: colors.statusProgress,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },

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
