import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
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
import { styles } from './dashboard/styles';
import { parseImportDate } from './dashboard/importDate.logic';
import { DriverCodesSection } from './dashboard/DriverCodesSection';
import { JobImportSection } from './dashboard/JobImportSection';
import { ActiveRoutesList } from './dashboard/ActiveRoutesList';

type Props = NativeStackScreenProps<AdminStackParamList, 'AdminDashboard'>;

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
      `This will create new codes for ${driverCount} driver slots.\n\n` +
        'Any codes drivers are using RIGHT NOW stop working immediately — ' +
        'drivers mid-route will be locked out until you give them their new code. Continue?',
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

    const parsed = parseImportDate(importDate);
    if (!parsed.ok) {
      Alert.alert(parsed.title, parsed.message);
      return;
    }
    const dateObj = parsed.date;

    setIsImporting(true);
    setImportResult(null);
    try {
      const jobs = await GoogleSheetsService.importJobs(sheetId.trim(), sheetName.trim(), dateObj);
      const { imported, skippedCompleted } = await GoogleSheetsService.saveJobsToRoute(jobs, selectedRouteCodeId);
      setImportResult(
        skippedCompleted > 0
          ? `✓ ${imported} jobs imported for ${importDate} — ${skippedCompleted} already completed, kept as-is.`
          : `✓ ${imported} jobs imported for ${importDate}.`
      );
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
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.signOutButton}
            onPress={() => navigation.navigate('Account')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.signOutText}>Account</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.signOutButton}
            onPress={handleSignOut}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.divider} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        <DriverCodesSection
          driverCount={driverCount}
          setDriverCount={setDriverCount}
          codes={codes}
          isLoadingCodes={isLoadingCodes}
          loadCodesError={loadCodesError}
          isGenerating={isGenerating}
          onGenerate={handleGenerateCodes}
          selectedRouteCodeId={selectedRouteCodeId}
          onSelect={setSelectedRouteCodeId}
        />

        <JobImportSection
          sheetId={sheetId}
          setSheetId={setSheetId}
          sheetName={sheetName}
          setSheetName={setSheetName}
          importDate={importDate}
          setImportDate={setImportDate}
          codes={codes}
          selectedRouteCodeId={selectedRouteCodeId}
          importResult={importResult}
          isImporting={isImporting}
          isGoogleConnected={isGoogleConnected}
          onConnectGoogle={() => navigation.navigate('GoogleConnect')}
          onImport={handleImportJobs}
        />

        <ActiveRoutesList
          codes={codes}
          onOpenRoute={(c) =>
            navigation.navigate('AdminRouteDetail', {
              routeCodeId: c.id,
              driverSlot: c.driverSlot,
              code: c.code,
            })
          }
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
