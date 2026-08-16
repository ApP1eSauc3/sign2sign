import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDriverSession } from '../../stores/useDriverSession';
import { useAppStore } from '../../stores/useAppStore';
import { AppMode } from '../../data/SignJob';
import { colors } from '../../utils/colors';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DriverStackParamList } from '../../navigation/DriverStack';
import { TextInputField } from '../components/TextInputField';
import { PrimaryButton } from '../components/PrimaryButton';

type Props = NativeStackScreenProps<DriverStackParamList, 'DriverCode'>;

export default function DriverCodeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const setMode = useAppStore((s) => s.setMode);
  const { loadSession, isLoadingSession, codeError, flushOfflineQueue } = useDriverSession();

  const [code, setCode] = useState('');

  // Flush any operations queued during a previous shift, BEFORE a session
  // exists. Queued ops carry their own route code, and the server accepts
  // finish-work writes for 24h past code expiry (migration 012) — so a driver
  // who went home offline only has to open the app for yesterday's photos and
  // completions to sync. Waiting for a successful loadSession would strand
  // them: an expired code can't open a session at all.
  useEffect(() => {
    flushOfflineQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit() {
    if (code.length !== 6) return;
    const success = await loadSession(code);
    if (success) navigation.replace('DriverMap');
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.wordmark}>S2S</Text>
        <Text style={styles.wordmarkSub}>DRIVER</Text>
      </View>

      {/* Content */}
      <View style={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={styles.label}>Enter your daily code</Text>
        <Text style={styles.hint}>Your dispatcher will give you a 6-digit code each morning.</Text>

        {/* Code input — large, centred, numeric */}
        <TextInputField
          variant="driverCode"
          value={code}
          onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="000000"
          returnKeyType="go"
          onSubmitEditing={handleSubmit}
          autoFocus
          accessibilityLabel="Six-digit daily route code"
          accessibilityHint="Enter the six digits your dispatcher gave you today"
          textContentType="oneTimeCode"
          error={codeError ?? undefined}
        />

        <PrimaryButton
          label="Start Route"
          size="gloved"
          disabled={code.length !== 6}
          loading={isLoadingSession}
          onPress={handleSubmit}
          style={styles.button}
        />

        <TouchableOpacity
          style={styles.backButton}
          onPress={() => setMode(AppMode.Undecided)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: 24,  // DESIGN §1.3 — on-grid (was 28, off-grid)
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  wordmark: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: -1,
  },
  wordmarkSub: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.brand,
    letterSpacing: 3,
    marginTop: -2,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,  // DESIGN §1.3 — on-grid (was 28, off-grid)
    justifyContent: 'center',
  },
  label: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  hint: {
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: 32,  // DESIGN §1.3 — on-grid (was 36, off-grid)
  },
  button: {
    marginTop: 8,
  },
  backButton: {
    alignSelf: 'center',
    marginTop: 28,
  },
  backText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
});
