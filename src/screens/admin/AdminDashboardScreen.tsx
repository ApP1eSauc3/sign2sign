import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { AuthService } from '../../services/AuthService';
import { RouteCodeService } from '../../services/RouteCodeService';
import { GoogleSheetsService } from '../../services/GoogleSheetsService';
import { useAppStore } from '../../stores/useAppStore';
import { AppMode, DailyCode } from '../../data/SignJob';
import { GoogleAuthService } from '../../services/GoogleAuthService';
import { colors } from '../../utils/colors';

type Props = NativeStackScreenProps<AdminStackParamList, 'AdminDashboard'>;

const MIN_DRIVERS = 1;
const MAX_DRIVERS = 8;

export default function AdminDashboardScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const setMode = useAppStore((s) => s.setMode);

  const [driverCount, setDriverCount] = useState(4);
  const [codes, setCodes] = useState<DailyCode[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingCodes, setIsLoadingCodes] = useState(true);
  const [loadCodesError, setLoadCodesError] = useState<string | null>(null);

  const [sheetId, setSheetId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [importDate, setImportDate] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
  const [selectedRouteCodeId, setSelectedRouteCodeId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);

  const loadCodes = useCallback(async () => {
    setIsLoadingCodes(true);
    setLoadCodesError(null);
    try {
      const activeCodes = await RouteCodeService.getActiveCodes();
      setCodes(activeCodes);
    } catch (e: unknown) {
      setLoadCodesError(e instanceof Error ? e.message : 'Could not load today\'s codes.');
    } finally {
      setIsLoadingCodes(false);
    }
  }, []);

  useEffect(() => {
    loadCodes();
    GoogleAuthService.isConnected().then(setIsGoogleConnected);
  }, [loadCodes]);

  async function handleSignOut() {
    await AuthService.signOut();
    setMode(AppMode.Undecided);
  }

  async function handleGenerateCodes() {
    if (isGenerating) return;
    Alert.alert(
      'Generate Today\'s Codes',
      `This will create new codes for ${driverCount} driver slots. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Generate',
          onPress: async () => {
            setIsGenerating(true);
            const slots = Array.from({ length: driverCount }, (_, i) => i + 1);
            try {
              const newCodes = await RouteCodeService.generateDailyCodes(slots);
              setCodes(newCodes);
              // Clear any stale selection — old code UUIDs are now deactivated.
              // Without this, the import button stays enabled with a stale ID,
              // and jobs would be silently assigned to an inactive route code.
              setSelectedRouteCodeId(null);
            } catch (e: unknown) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to generate codes.');
            } finally {
              setIsGenerating(false);
            }
          },
        },
      ]
    );
  }

  async function handleImportJobs() {
    if (!sheetId.trim()) {
      Alert.alert('Sheet ID required', 'Paste the Google Sheet ID to import.');
      return;
    }
    if (!sheetName.trim()) {
      Alert.alert('Tab name required', 'Enter the sheet tab name (e.g. Sheet44).');
      return;
    }
    if (!selectedRouteCodeId) {
      Alert.alert('Select a driver', 'Tap a driver code below to assign jobs to them.');
      return;
    }

    // Validate YYYY-MM-DD strictly. Without this, "2026-13-40" rolls over to
    // a valid Date object that silently matches zero rows and the user just
    // sees "No jobs found" with no hint that the date itself was malformed.
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(importDate);
    if (!match) {
      Alert.alert('Invalid date', 'Use the format YYYY-MM-DD (e.g. 2026-05-17).');
      return;
    }
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const dateObj = new Date(y, m - 1, d);
    if (
      dateObj.getFullYear() !== y ||
      dateObj.getMonth() !== m - 1 ||
      dateObj.getDate() !== d
    ) {
      Alert.alert('Invalid date', 'That date does not exist — check month and day.');
      return;
    }

    setIsImporting(true);
    setImportResult(null);
    try {
      const jobs = await GoogleSheetsService.importJobs(sheetId.trim(), sheetName.trim(), dateObj);
      await GoogleSheetsService.saveJobsToRoute(jobs, selectedRouteCodeId);
      setImportResult(`✓ ${jobs.length} jobs imported for ${importDate}.`);
      setSheetId('');
      setSheetName('');
      setSelectedRouteCodeId(null);
    } catch (e: unknown) {
      setImportResult(`✗ ${e instanceof Error ? e.message : 'Import failed.'}`);
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Dashboard</Text>
          <Text style={styles.headerSub}>SIGN2SIGN ADMIN</Text>
        </View>
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.divider} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Today's Codes ───────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>TODAY'S CODES</Text>
          <TouchableOpacity
            style={[styles.sectionAction, isGenerating && styles.sectionActionDisabled]}
            onPress={handleGenerateCodes}
            disabled={isGenerating}
          >
            {isGenerating
              ? <ActivityIndicator size="small" color={colors.brand} />
              : <Text style={styles.sectionActionText}>Generate</Text>
            }
          </TouchableOpacity>
        </View>

        {/* Driver count stepper */}
        <View style={styles.stepperRow}>
          <Text style={styles.stepperLabel}>Drivers</Text>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={[styles.stepperButton, driverCount <= MIN_DRIVERS && styles.stepperButtonDisabled]}
              onPress={() => setDriverCount((n) => Math.max(MIN_DRIVERS, n - 1))}
              disabled={driverCount <= MIN_DRIVERS}
            >
              <Text style={styles.stepperButtonText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.stepperValue}>{driverCount}</Text>
            <TouchableOpacity
              style={[styles.stepperButton, driverCount >= MAX_DRIVERS && styles.stepperButtonDisabled]}
              onPress={() => setDriverCount((n) => Math.min(MAX_DRIVERS, n + 1))}
              disabled={driverCount >= MAX_DRIVERS}
            >
              <Text style={styles.stepperButtonText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {isLoadingCodes ? (
          <View style={styles.sectionCard}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : loadCodesError ? (
          <View style={styles.sectionCard}>
            <Text style={[styles.emptyText, { color: colors.adminError }]}>{loadCodesError}</Text>
            <Text style={styles.emptyHint}>Check your connection and pull to refresh.</Text>
          </View>
        ) : codes.length === 0 ? (
          <View style={styles.sectionCard}>
            <Text style={styles.emptyText}>No codes generated yet today.</Text>
            <Text style={styles.emptyHint}>Tap Generate to create driver codes.</Text>
          </View>
        ) : (
          <View style={styles.codesGrid}>
            {codes.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[
                  styles.codeCard,
                  selectedRouteCodeId === c.id && styles.codeCardSelected,
                ]}
                onPress={() =>
                  setSelectedRouteCodeId(selectedRouteCodeId === c.id ? null : c.id)
                }
              >
                <Text style={styles.codeSlot}>DRIVER {c.driverSlot}</Text>
                <Text style={styles.codeValue}>{c.code}</Text>
                {selectedRouteCodeId === c.id && (
                  <Text style={styles.codeSelectedLabel}>Selected for import</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Job Import ──────────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionLabel, { marginTop: 28, marginBottom: 0 }]}>JOB IMPORT</Text>
          <TouchableOpacity
            style={[styles.sectionAction, { marginTop: 28 }, isGoogleConnected && styles.sectionActionConnected]}
            onPress={() => navigation.navigate('GoogleConnect')}
          >
            <Text style={[styles.sectionActionText, isGoogleConnected && { color: colors.adminSuccess }]}>
              {isGoogleConnected ? '✓ Google Connected' : 'Connect Google'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.sectionCard, { marginTop: 10 }]}>
          <Text style={styles.fieldLabel}>Google Sheet ID</Text>
          <TextInput
            style={styles.input}
            value={sheetId}
            onChangeText={setSheetId}
            placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
            placeholderTextColor={colors.adminTextTertiary}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.fieldLabel}>Sheet Tab Name</Text>
          <TextInput
            style={styles.input}
            value={sheetName}
            onChangeText={setSheetName}
            placeholder="Sheet44"
            placeholderTextColor={colors.adminTextTertiary}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.fieldLabel}>Import Date</Text>
          <TextInput
            style={styles.input}
            value={importDate}
            onChangeText={setImportDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.adminTextTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numeric"
          />
          <View style={styles.sheetFormatCard}>
            <Text style={styles.sheetFormatTitle}>EXPECTED COLUMN ORDER (row 2 onwards)</Text>
            <Text style={styles.sheetFormatRow}>A  Date</Text>
            <Text style={styles.sheetFormatRow}>B  Agency  <Text style={styles.sheetFormatHint}>(client name)</Text></Text>
            <Text style={styles.sheetFormatRow}>C  Agent  <Text style={styles.sheetFormatHint}>(name)</Text></Text>
            <Text style={styles.sheetFormatRow}>D  Notes  <Text style={styles.sheetFormatHint}>(install instructions, optional)</Text></Text>
            <Text style={styles.sheetFormatRow}>E  Size  <Text style={styles.sheetFormatHint}>(6x4, 4x3, etc., optional)</Text></Text>
            <Text style={styles.sheetFormatRow}>F  Printed  <Text style={styles.sheetFormatHint}>(skipped)</Text></Text>
            <Text style={styles.sheetFormatRow}>G  Address  <Text style={styles.sheetFormatHint}>(required — geocoded on import)</Text></Text>
            <Text style={styles.sheetFormatNote}>
              Only rows matching the import date are imported. Addresses are geocoded automatically — requires EXPO_PUBLIC_GOOGLE_MAPS_API_KEY. Agent email is left blank; add it via the route detail screen before sending completion emails.
            </Text>
          </View>

          {selectedRouteCodeId ? (
            <Text style={styles.assignNote}>
              Assigning to Driver{' '}
              {codes.find((c) => c.id === selectedRouteCodeId)?.driverSlot} —{' '}
              {codes.find((c) => c.id === selectedRouteCodeId)?.code}
            </Text>
          ) : (
            <Text style={styles.assignHint}>
              Select a driver code above to assign imported jobs.
            </Text>
          )}

          {importResult && (
            <Text
              style={[
                styles.importResult,
                importResult.startsWith('✓')
                  ? styles.importResultSuccess
                  : styles.importResultError,
              ]}
            >
              {importResult}
            </Text>
          )}

          <TouchableOpacity
            style={[
              styles.importButton,
              (!sheetId.trim() || !sheetName.trim() || !selectedRouteCodeId || isImporting) &&
                styles.importButtonDisabled,
            ]}
            onPress={handleImportJobs}
            disabled={!sheetId.trim() || !sheetName.trim() || !selectedRouteCodeId || isImporting}
          >
            {isImporting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.importButtonText}>Import Jobs from Sheet</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Active Routes ───────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { marginTop: 28 }]}>ACTIVE ROUTES</Text>
        <View style={styles.sectionCard}>
          {codes.length === 0 ? (
            <Text style={styles.emptyText}>No active routes today.</Text>
          ) : (
            codes.map((c, i) => (
              <TouchableOpacity
                key={c.id}
                style={[
                  styles.routeRow,
                  i < codes.length - 1 && styles.routeRowBorder,
                ]}
                onPress={() =>
                  navigation.navigate('AdminRouteDetail', {
                    routeCodeId: c.id,
                    driverSlot: c.driverSlot,
                    code: c.code,
                  })
                }
                activeOpacity={0.7}
              >
                <View style={styles.routeSlotDot} />
                <View style={styles.routeRowContent}>
                  <Text style={styles.routeSlotLabel}>Driver {c.driverSlot}</Text>
                  <Text style={styles.routeCode}>{c.code}</Text>
                </View>
                <View style={styles.routeRowRight}>
                  <View style={styles.routeActiveBadge}>
                    <Text style={styles.routeActiveBadgeText}>ACTIVE</Text>
                  </View>
                  <Text style={styles.routeChevron}>›</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: colors.white,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: colors.adminText },
  headerSub: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.brand,
    letterSpacing: 1.5,
    marginTop: 1,
  },
  signOutButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.adminBorder,
  },
  signOutText: { fontSize: 14, fontWeight: '600', color: colors.adminTextSecondary },

  divider: { height: 1, backgroundColor: colors.adminDivider },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 24 },  // DESIGN §2.4 — standard page margin

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.adminTextTertiary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  sectionAction: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  sectionActionDisabled: { opacity: 0.4 },
  sectionActionConnected: { borderColor: colors.adminSuccess, backgroundColor: colors.adminSuccessBg },
  sectionActionText: { fontSize: 13, fontWeight: '600', color: colors.brand },

  sectionCard: {
    backgroundColor: colors.adminSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.adminDivider,
    padding: 16,
  },
  emptyText: { fontSize: 15, color: colors.adminTextTertiary },
  emptyHint: { fontSize: 13, color: colors.adminTextHint, marginTop: 4 },

  // Codes grid
  codesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  codeCard: {
    backgroundColor: colors.adminSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.adminCardBorder,
    padding: 14,
    minWidth: '47%',
    flex: 1,
  },
  codeCardSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.adminSelectedBg,
  },
  codeSlot: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.adminTextTertiary,
    letterSpacing: 1,
    marginBottom: 4,
  },
  codeValue: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.adminText,
    letterSpacing: 4,
    fontVariant: ['tabular-nums'],
  },
  codeSelectedLabel: {
    fontSize: 11,
    color: colors.brand,
    fontWeight: '600',
    marginTop: 6,
  },

  // Import form
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.adminTextSecondary,
    marginBottom: 6,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.adminBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: colors.adminText,
    backgroundColor: colors.white,
    marginBottom: 10,
  },
  // Sheet format reference
  sheetFormatCard: {
    backgroundColor: colors.adminDivider,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    gap: 3,
  },
  sheetFormatTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.adminTextTertiary,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  sheetFormatRow: {
    fontSize: 12,
    color: colors.adminTextSecondary,
    fontVariant: ['tabular-nums'],
  },
  sheetFormatHint: {
    color: colors.adminTextHint,
    fontStyle: 'italic',
  },
  sheetFormatNote: {
    fontSize: 11,
    color: colors.adminTextHint,
    marginTop: 8,
    lineHeight: 16,
  },

  assignNote: { fontSize: 13, color: colors.brand, fontWeight: '600', marginBottom: 12 },
  assignHint: { fontSize: 13, color: colors.adminTextHint, marginBottom: 12 },
  importResult: { fontSize: 14, fontWeight: '500', marginBottom: 12 },
  importResultSuccess: { color: colors.adminSuccess },
  importResultError: { color: colors.adminError },
  importButton: {
    height: 48,
    backgroundColor: colors.brand,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importButtonDisabled: { opacity: 0.4 },
  importButtonText: { color: colors.white, fontSize: 15, fontWeight: '600' },

  // Driver count stepper
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.adminSurface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.adminCardBorder,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 10,
  },
  stepperLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.adminTextSecondary,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.adminBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonDisabled: { opacity: 0.3 },
  stepperButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.adminText,
    lineHeight: 22,
  },
  stepperValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.adminText,
    minWidth: 20,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },

  // Routes list
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  routeRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.adminDivider },
  routeSlotDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.statusComplete,
    marginRight: 12,
  },
  routeRowContent: { flex: 1 },
  routeSlotLabel: { fontSize: 14, fontWeight: '600', color: colors.adminText },
  routeCode: {
    fontSize: 13,
    color: colors.adminTextTertiary,
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  routeRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  routeActiveBadge: {
    backgroundColor: colors.statusCompleteBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  routeActiveBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.statusComplete,
    letterSpacing: 0.8,
  },
  routeChevron: {
    fontSize: 18,
    color: colors.adminTextTertiary,
    fontWeight: '400',
  },
});
