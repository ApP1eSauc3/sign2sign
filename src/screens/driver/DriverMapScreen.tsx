import { useRef, useEffect, useState, useMemo } from 'react';
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
import { AppMode, SignJob } from '../../data/SignJob';
import { colors } from '../../utils/colors';
import { RouteService, LatLng, RouteResult } from '../../services/RouteService';
import { OfflineBanner } from '../OfflineBanner';
import { orderJobsForDisplay } from './mapOrder.logic';
import { styles } from './map/styles';
import { JobPin } from './map/JobPin';
import { JobCallout } from './map/JobCallout';

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
