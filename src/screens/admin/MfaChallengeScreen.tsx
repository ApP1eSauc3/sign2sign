import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { AuthService } from '../../services/AuthService';
import { useAppStore } from '../../stores/useAppStore';
import { AppMode } from '../../data/SignJob';
import { colors } from '../../utils/colors';
import { TextInputField } from '../components/TextInputField';
import { PrimaryButton } from '../components/PrimaryButton';
import { normaliseTotpInput } from './account/twoStep.logic';

type Props = NativeStackScreenProps<AdminStackParamList, 'MfaChallenge'>;

// Second step of sign-in for an admin who turned on two-step sign-in. The
// password has already been accepted and the session exists at aal1; the
// database (migration 018) refuses that session until this code lifts it to
// aal2. Mode stays AdminPending until then, so nothing behind the login can
// render early.
export default function MfaChallengeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const setMode = useAppStore((s) => s.setMode);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleVerify() {
    if (loading) return;
    setError(null);
    setLoading(true);
    const err = await AuthService.verifyMfaCode(code);
    setLoading(false);
    if (err) {
      setError(err.message);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setMode(AppMode.AdminAuthenticated);
    navigation.replace('AdminDashboard');
  }

  // Abandons the half-signed-in session rather than leaving an aal1 session
  // lying in storage for the next launch to find.
  async function handleUseAnotherAccount() {
    await AuthService.signOut();
    navigation.replace('AdminLogin');
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Two-step sign-in</Text>
        <Text style={styles.body}>
          Open your authenticator app and enter the 6-digit code for Sign2Sign.
        </Text>

        <TextInputField
          label="Code from the app"
          placeholder="123456"
          value={code}
          onChangeText={(t) => setCode(normaliseTotpInput(t))}
          keyboardType="number-pad"
          maxLength={6}
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          autoFocus
          returnKeyType="go"
          onSubmitEditing={handleVerify}
          accessibilityLabel="Six-digit code from your authenticator app"
          error={error ?? undefined}
        />

        <PrimaryButton
          label="Verify"
          onPress={handleVerify}
          loading={loading}
          disabled={loading || code.length !== 6}
        />

        <TouchableOpacity
          style={styles.link}
          onPress={handleUseAnotherAccount}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Sign in with a different account"
        >
          <Text style={styles.linkText}>Sign in with a different account</Text>
        </TouchableOpacity>

        <View style={styles.help}>
          <Text style={styles.helpText}>
            Lost your phone? Two-step sign-in can't be removed from inside the app. Ask whoever
            manages Sign2Sign's Supabase project to remove your authenticator, then sign in with
            your password and turn it on again.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  content: { paddingHorizontal: 32 },
  title: { fontSize: 22, fontWeight: '700', color: colors.adminText, marginBottom: 8 },
  body: { fontSize: 15, color: colors.adminTextSecondary, lineHeight: 22, marginBottom: 24 },
  link: { alignSelf: 'center', marginTop: 24 },
  linkText: { color: colors.brandDeep, fontSize: 15, fontWeight: '600' },  // 6.5:1 on white
  help: { marginTop: 32 },
  helpText: { fontSize: 13, color: colors.adminTextTertiary, lineHeight: 18 },
});
