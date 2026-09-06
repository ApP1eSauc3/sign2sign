import { Dispatch, SetStateAction } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { DailyCode } from '../../../data/SignJob';
import { colors } from '../../../utils/colors';
import { AdminCard } from '../../components/AdminCard';
import { EmptyState } from '../../components/EmptyState';
import { styles } from './styles';

const MIN_DRIVERS = 1;
const MAX_DRIVERS = 8;

type Props = {
  driverCount: number;
  setDriverCount: Dispatch<SetStateAction<number>>;
  codes: DailyCode[];
  isLoadingCodes: boolean;
  loadCodesError: string | null;
  isGenerating: boolean;
  onGenerate: () => void;
  selectedRouteCodeId: string | null;
  onSelect: (id: string | null) => void;
};

export function DriverCodesSection({
  driverCount,
  setDriverCount,
  codes,
  isLoadingCodes,
  loadCodesError,
  isGenerating,
  onGenerate,
  selectedRouteCodeId,
  onSelect,
}: Props) {
  return (
    <>
      {/* ── Today's Codes ───────────────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>TODAY'S CODES</Text>
        <TouchableOpacity
          style={[styles.sectionAction, isGenerating && styles.sectionActionDisabled]}
          onPress={onGenerate}
          disabled={isGenerating}
        >
          {isGenerating
            ? <ActivityIndicator size="small" color={colors.brand} />
            : <Text style={styles.sectionActionText}>Generate</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Driver count stepper */}
      <AdminCard style={styles.stepperRow}>
        <Text style={styles.stepperLabel}>Drivers</Text>
        <View style={styles.stepper}>
          <TouchableOpacity
            style={[styles.stepperButton, driverCount <= MIN_DRIVERS && styles.stepperButtonDisabled]}
            onPress={() => setDriverCount((n) => Math.max(MIN_DRIVERS, n - 1))}
            disabled={driverCount <= MIN_DRIVERS}
            accessibilityRole="button"
            accessibilityLabel="Decrease driver count"
            accessibilityState={{ disabled: driverCount <= MIN_DRIVERS }}
          >
            <Text style={styles.stepperButtonText} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">−</Text>
          </TouchableOpacity>
          <Text
            style={styles.stepperValue}
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${driverCount} drivers`}
          >{driverCount}</Text>
          <TouchableOpacity
            style={[styles.stepperButton, driverCount >= MAX_DRIVERS && styles.stepperButtonDisabled]}
            onPress={() => setDriverCount((n) => Math.min(MAX_DRIVERS, n + 1))}
            disabled={driverCount >= MAX_DRIVERS}
            accessibilityRole="button"
            accessibilityLabel="Increase driver count"
            accessibilityState={{ disabled: driverCount >= MAX_DRIVERS }}
          >
            <Text style={styles.stepperButtonText} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">+</Text>
          </TouchableOpacity>
        </View>
      </AdminCard>

      {isLoadingCodes ? (
        <AdminCard>
          <ActivityIndicator color={colors.brand} />
        </AdminCard>
      ) : loadCodesError ? (
        <AdminCard>
          <Text style={[styles.emptyText, { color: colors.adminError }]}>{loadCodesError}</Text>
          <Text style={styles.emptyHint}>Check your connection and pull to refresh.</Text>
        </AdminCard>
      ) : codes.length === 0 ? (
        <AdminCard>
          <EmptyState
            variant="admin"
            title="No codes generated yet today."
            hint="Tap Generate to create driver codes."
          />
        </AdminCard>
      ) : (
        <View style={styles.codesGrid}>
          {codes.map((c) => (
            <TouchableOpacity
              key={c.id}
              onPress={() =>
                onSelect(selectedRouteCodeId === c.id ? null : c.id)
              }
              accessibilityRole="button"
              accessibilityLabel={`Driver ${c.driverSlot}, code ${c.code.split('').join(' ')}`}
              accessibilityState={{ selected: selectedRouteCodeId === c.id }}
              accessibilityHint="Selects this driver to receive imported jobs"
              style={styles.codeCardWrap}
            >
              <AdminCard selected={selectedRouteCodeId === c.id}>
                <Text style={styles.codeSlot}>DRIVER {c.driverSlot}</Text>
                <Text style={styles.codeValue}>{c.code}</Text>
                {selectedRouteCodeId === c.id && (
                  <Text style={styles.codeSelectedLabel}>Selected for import</Text>
                )}
              </AdminCard>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </>
  );
}
