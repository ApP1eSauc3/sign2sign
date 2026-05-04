import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
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

type Props = NativeStackScreenProps<DriverStackParamList, 'DriverCode'>;

export default function DriverCodeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const setMode = useAppStore((s) => s.setMode);
  const { loadSession, isLoadingSession, codeError } = useDriverSession();

  const [code, setCode] = useState('');

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
        <TextInput
          style={[styles.codeInput, codeError ? styles.codeInputError : null]}
          value={code}
          onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="000000"
          placeholderTextColor={colors.textDisabled}
          returnKeyType="go"
          onSubmitEditing={handleSubmit}
          autoFocus
        />

        {codeError && <Text style={styles.errorText}>{codeError}</Text>}

        <TouchableOpacity
          style={[
            styles.button,
            (code.length !== 6 || isLoadingSession) && styles.buttonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={code.length !== 6 || isLoadingSession}
          activeOpacity={0.85}
        >
          {isLoadingSession ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={[
              styles.buttonText,
              (code.length !== 6) && styles.buttonTextDisabled,
            ]}>Start Route</Text>
          )}
        </TouchableOpacity>

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
  codeInput: {
    height: 80,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: 36,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 12,
    marginBottom: 16,
  },
  codeInputError: {
    borderColor: colors.statusFailed,
  },
  errorText: {
    color: colors.statusFailed,
    fontSize: 15,
    marginBottom: 16,
    textAlign: 'center',
  },
  button: {
    height: 64,
    backgroundColor: colors.brand,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: colors.surfaceActive,  // DESIGN §1.5 — disabled CTA, never opacity
  },
  buttonText: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '700',
  },
  buttonTextDisabled: {
    color: colors.textDisabled,  // DESIGN §1.4 — disabled text token
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
