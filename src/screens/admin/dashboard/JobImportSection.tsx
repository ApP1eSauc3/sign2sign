import { Dispatch, SetStateAction } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { DailyCode } from '../../../data/SignJob';
import { colors } from '../../../utils/colors';
import { AdminCard } from '../../components/AdminCard';
import { TextInputField } from '../../components/TextInputField';
import { PrimaryButton } from '../../components/PrimaryButton';
import { styles } from './styles';

type Props = {
  sheetId: string;
  setSheetId: Dispatch<SetStateAction<string>>;
  sheetName: string;
  setSheetName: Dispatch<SetStateAction<string>>;
  importDate: string;
  setImportDate: Dispatch<SetStateAction<string>>;
  codes: DailyCode[];
  selectedRouteCodeId: string | null;
  importResult: string | null;
  isImporting: boolean;
  isGoogleConnected: boolean;
  onConnectGoogle: () => void;
  onImport: () => void;
};

export function JobImportSection({
  sheetId,
  setSheetId,
  sheetName,
  setSheetName,
  importDate,
  setImportDate,
  codes,
  selectedRouteCodeId,
  importResult,
  isImporting,
  isGoogleConnected,
  onConnectGoogle,
  onImport,
}: Props) {
  return (
    <>
      {/* ── Job Import ──────────────────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionLabel, { marginTop: 28, marginBottom: 0 }]}>JOB IMPORT</Text>
        <TouchableOpacity
          style={[styles.sectionAction, { marginTop: 28 }, isGoogleConnected && styles.sectionActionConnected]}
          onPress={onConnectGoogle}
        >
          <Text style={[styles.sectionActionText, isGoogleConnected && { color: colors.adminSuccess }]}>
            {isGoogleConnected ? '✓ Google Connected' : 'Connect Google'}
          </Text>
        </TouchableOpacity>
      </View>

      <AdminCard style={{ marginTop: 10 }}>
        <TextInputField
          variant="compact"
          label="Google Sheet ID"
          value={sheetId}
          onChangeText={setSheetId}
          placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInputField
          variant="compact"
          label="Sheet Tab Name"
          value={sheetName}
          onChangeText={setSheetName}
          placeholder="Sheet44"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInputField
          variant="compact"
          label="Import Date"
          value={importDate}
          onChangeText={setImportDate}
          placeholder="YYYY-MM-DD"
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
            Only rows matching the import date are imported. Addresses are geocoded automatically. Agent email is left blank; add it via the route detail screen before sending completion emails.
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

        <PrimaryButton
          label="Import Jobs from Sheet"
          size="admin"
          loading={isImporting}
          disabled={!sheetId.trim() || !sheetName.trim() || !selectedRouteCodeId}
          onPress={onImport}
        />
      </AdminCard>
    </>
  );
}
