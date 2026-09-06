import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { RouteCodeService } from '../../services/RouteCodeService';
import { SignJob } from '../../data/SignJob';
import { colors } from '../../utils/colors';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { styles } from './routeDetail/styles';
import { RouteJobRow } from './routeDetail/RouteJobRow';

type Props = NativeStackScreenProps<AdminStackParamList, 'AdminRouteDetail'>;

// Stable identities — see DriverRouteScreen for the same reasoning.
const keyExtractor = (j: SignJob) => j.id;
const Separator = () => <View style={styles.separator} />;
// renderItem is defined inside the component below — it closes over the
// refresh callback, so it cannot be a module constant like the others.

export default function AdminRouteDetailScreen({ route, navigation }: Props) {
  const { routeCodeId, driverSlot, code } = route.params;
  const insets = useSafeAreaInsets();

  const [jobs, setJobs] = useState<SignJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async (refresh = false) => {
    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const result = await RouteCodeService.getRouteJobs(routeCodeId);
      setJobs(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load jobs.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [routeCodeId]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // Re-fetch after a notice is approved so the row flips from the button to
  // the "Notice sent" pill. Refetching rather than patching local state keeps
  // notice_sent_at coming from one place — the database — so a second admin
  // approving the same job concurrently cannot leave this screen claiming a
  // different sender or time than the row actually holds.
  const handleNoticeSent = useCallback(() => { loadJobs(true); }, [loadJobs]);

  // Closes over handleNoticeSent, so it is defined here rather than at module
  // scope like keyExtractor and Separator. useCallback keeps the identity
  // stable so FlatList does not re-render every row on unrelated state changes.
  const renderItem = useCallback(
    ({ item }: { item: SignJob }) => <RouteJobRow job={item} onSent={handleNoticeSent} />,
    [handleNoticeSent]
  );

  // One pass instead of three separate `.filter().length` sweeps re-run on
  // every render — including every render caused by pull-to-refresh state.
  const { done, installs, removals } = useMemo(() => {
    let done = 0, installs = 0, removals = 0;
    for (const j of jobs) {
      if (j.isComplete) done++;
      if (j.jobType === 'install') installs++;
      else removals++;
    }
    return { done, installs, removals };
  }, [jobs]);

  const total = jobs.length;
  const progressPct = total > 0 ? (done / total) * 100 : 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <ScreenHeader
        onBack={() => navigation.goBack()}
        backLabel="Dashboard"
        variant="admin"
      />

      {/* Route hero */}
      <View style={styles.hero}>
        <View>
          <Text style={styles.heroSlot}>DRIVER {driverSlot}</Text>
          <Text style={styles.heroCode}>{code}</Text>
        </View>
        <View style={styles.heroStats}>
          {total > 0 && (
            <>
              <Text style={styles.heroStatItem}>
                <Text style={styles.heroStatNum}>{installs}</Text> install{installs !== 1 ? 's' : ''}
              </Text>
              <Text style={styles.heroStatDot}>·</Text>
              <Text style={styles.heroStatItem}>
                <Text style={styles.heroStatNum}>{removals}</Text> removal{removals !== 1 ? 's' : ''}
              </Text>
            </>
          )}
        </View>
      </View>

      {/* Progress bar */}
      {total > 0 && (
        <View style={styles.progressSection}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
          </View>
          <Text style={styles.progressLabel}>
            {done} of {total} complete
          </Text>
        </View>
      )}

      <View style={styles.divider} />

      {/* Body */}
      {isLoading ? (
        <View style={styles.centred}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : error ? (
        <View style={styles.centred}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadJobs()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={keyExtractor}
          contentContainerStyle={[
            styles.list,
            total === 0 && styles.listEmpty,
            { paddingBottom: insets.bottom + 24 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadJobs(true)}
              tintColor={colors.brand}
            />
          }
          renderItem={renderItem}
          ItemSeparatorComponent={Separator}
          ListEmptyComponent={
            <EmptyState
              variant="admin"
              title="No jobs assigned"
              hint="Import a Google Sheet from the dashboard to add jobs to this route."
            />
          }
        />
      )}
    </View>
  );
}
