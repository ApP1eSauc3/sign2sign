import { TouchableOpacity, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { JobUploadState } from '../../data/SignJob';
import { colors } from '../../utils/colors';
import { getAdvancingButtonState } from './advancingActionButton.logic';

interface AdvancingActionButtonProps {
  uploadState: JobUploadState;
  isComplete: boolean;
  isMarkingComplete: boolean;
  onPress: () => void;
}

export function AdvancingActionButton({
  uploadState,
  isComplete,
  isMarkingComplete,
  onPress,
}: AdvancingActionButtonProps) {
  const button = getAdvancingButtonState(uploadState, isComplete, isMarkingComplete);

  return (
    <TouchableOpacity
      style={[styles.button, { backgroundColor: button.color }]}
      onPress={onPress}
      disabled={!button.enabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={button.label}
      accessibilityState={{ disabled: !button.enabled, busy: button.loading }}
    >
      {button.loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text style={styles.label}>{button.label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 64,        // DESIGN §1.8 / §3.4 — gloved-hand minimum
    borderRadius: 8,   // DESIGN — standardized button radius (was 12)
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.white,
  },
});
