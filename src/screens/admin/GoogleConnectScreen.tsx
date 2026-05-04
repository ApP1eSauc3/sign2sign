import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as AuthSession from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { GoogleAuthService } from '../../services/GoogleAuthService';
import { colors } from '../../utils/colors';

type Props = NativeStackScreenProps<AdminStackParamList, 'GoogleConnect'>;

export default function GoogleConnectScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: GoogleAuthService.CLIENT_ID_IOS,
    webClientId: GoogleAuthService.CLIENT_ID_WEB,
    scopes: GoogleAuthService.SCOPES,
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const { code } = response.params;
      // redirectUri must match what was sent in the auth request
      const redirectUri = AuthSession.makeRedirectUri({ scheme: 'sign2sign', path: 'oauth' });
      setIsConnecting(true);
      setError(null);
      (async () => {
        try {
          await GoogleAuthService.exchangeCodeForTokens(code, redirectUri, request?.codeVerifier);
          navigation.goBack();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Authentication failed');
        } finally {
          setIsConnecting(false);
        }
      })();
    } else if (response?.type === 'error') {
      setError(response.error?.message ?? 'Authentication failed');
    }
  }, [response]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.nav}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.navBack}>← Back</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={styles.title}>Connect Google Account</Text>
        <Text style={styles.body}>
          Sign2Sign imports jobs directly from Google Sheets. Connect your Google
          account once and your spreadsheets will be accessible for import.
        </Text>

        <View style={styles.scopeCard}>
          <Text style={styles.scopeLabel}>PERMISSIONS REQUESTED</Text>
          <Text style={styles.scopeItem}>• Read-only access to Google Sheets</Text>
          <Text style={styles.scopeNote}>
            Sign2Sign cannot modify your spreadsheets.
          </Text>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, (!request || isConnecting) && styles.buttonDisabled]}
          onPress={() => promptAsync()}
          disabled={!request || isConnecting}
          activeOpacity={0.85}
        >
          {isConnecting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.buttonText}>Connect with Google</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  nav: { paddingHorizontal: 24, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.adminDivider },
  navBack: { fontSize: 15, fontWeight: '600', color: colors.brand },

  content: { flex: 1, paddingHorizontal: 24, paddingTop: 32 },
  title: { fontSize: 22, fontWeight: '700', color: colors.adminText, marginBottom: 12 },
  body: { fontSize: 15, color: colors.adminTextSecondary, lineHeight: 22, marginBottom: 28 },

  scopeCard: {
    backgroundColor: colors.adminSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.adminCardBorder,
    padding: 16,
    marginBottom: 28,
  },
  scopeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.adminTextTertiary,
    letterSpacing: 1,
    marginBottom: 10,
  },
  scopeItem: { fontSize: 14, color: colors.adminText, marginBottom: 6 },
  scopeNote: { fontSize: 13, color: colors.adminTextTertiary, marginTop: 4 },

  errorBox: {
    backgroundColor: colors.statusFailedBg,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { color: colors.statusFailed, fontSize: 14, fontWeight: '500' },

  button: {
    height: 56,
    backgroundColor: colors.brand,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '600' },
});
