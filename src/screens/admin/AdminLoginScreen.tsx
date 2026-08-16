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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { AuthService } from '../../services/AuthService';
import { useAppStore } from '../../stores/useAppStore';
import { AppMode } from '../../data/SignJob';
import { colors } from '../../utils/colors';
import { TextInputField } from '../components/TextInputField';
import { PrimaryButton } from '../components/PrimaryButton';

type Props = NativeStackScreenProps<AdminStackParamList, 'AdminLogin'>;

export default function AdminLoginScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const setMode = useAppStore((s) => s.setMode);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Session restoration is handled by AppNavigator — this screen only renders
  // when there is no valid session, so no getSession() check is needed here.

  async function handleLogin() {
    setError(null);
    setLoading(true);
    const authError = await AuthService.signIn(email.trim(), password);
    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    navigation.replace('AdminDashboard');
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Brand header — blue fills the block, white text on top */}
      <View style={[styles.header, { paddingTop: insets.top + 40 }]}>
        <Text style={styles.wordmark}>S2S</Text>
        <Text style={styles.wordmarkSub}>SIGN2SIGN</Text>
      </View>

      {/* Form area */}
      <ScrollView
        style={styles.formScroll}
        contentContainerStyle={[
          styles.form,
          { paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.formTitle}>Admin Login</Text>

        <TextInputField
          label="Email"
          placeholder="you@sign2site.com.au"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          returnKeyType="next"
          textContentType="username"
          autoComplete="email"
          accessibilityLabel="Email address"
          value={email}
          onChangeText={setEmail}
        />

        <TextInputField
          label="Password"
          placeholder="Password"
          secureTextEntry
          returnKeyType="go"
          onSubmitEditing={handleLogin}
          textContentType="password"
          autoComplete="current-password"
          accessibilityLabel="Password"
          value={password}
          onChangeText={setPassword}
        />

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <PrimaryButton
          label="Log In"
          onPress={handleLogin}
          loading={loading}
          style={styles.button}
        />

        <TouchableOpacity
          style={styles.backButton}
          onPress={() => setMode(AppMode.Undecided)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
  },

  // Brand header — blue fills the block entirely (brand identity rule)
  header: {
    backgroundColor: colors.brand,
    paddingHorizontal: 32,
    paddingBottom: 40,
    alignItems: 'flex-start',
  },
  wordmark: {
    fontSize: 48,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: -1,
  },
  wordmarkSub: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.white,
    letterSpacing: 3,
    opacity: 0.8,
    marginTop: -4,
  },

  // Form
  formScroll: {
    flex: 1,
    backgroundColor: colors.white,
  },
  form: {
    paddingHorizontal: 32,
    paddingTop: 36,
  },
  formTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.adminText,
    marginBottom: 24,  // DESIGN §1.3 — on-grid (was 28, off-grid)
  },
  // Error
  errorBox: {
    backgroundColor: colors.statusFailedBg,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: colors.statusFailed,
    fontSize: 15,
    fontWeight: '500',
  },

  // CTA — brand blue fills entirely, white text
  button: {
    marginTop: 4,
  },

  // Back
  backButton: {
    alignSelf: 'center',
    marginTop: 24,
  },
  backText: {
    color: colors.adminTextTertiary,
    fontSize: 14,
  },
});
