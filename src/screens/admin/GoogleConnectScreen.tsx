import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Google from 'expo-auth-session/providers/google';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { GoogleAuthService } from '../../services/GoogleAuthService';
import { colors } from '../../utils/colors';
import { ScreenHeader } from '../components/ScreenHeader';
import { AdminCard } from '../components/AdminCard';
import { PrimaryButton } from '../components/PrimaryButton';

type Props = NativeStackScreenProps<AdminStackParamList, 'GoogleConnect'>;

const isElectron = typeof window !== 'undefined' && !!window.electron;

export default function GoogleConnectScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: GoogleAuthService.CLIENT_ID_IOS,
    webClientId: GoogleAuthService.CLIENT_ID_WEB,
    scopes: GoogleAuthService.SCOPES,
  });

  // ── Native / web (non-Electron) OAuth response ─────────────────────────────
  useEffect(() => {
    if (response?.type === 'success') {
      const { code } = response.params;
      // Use the exact redirect URI the auth request was built with.
      // Google rejects the token exchange with redirect_uri_mismatch if this
      // differs by even a trailing slash from the one used in the authorize call.
      const redirectUri = request?.redirectUri;
      const clientId = request?.clientId;
      if (!redirectUri || !clientId) {
        setError('OAuth request not ready — try again.');
        return;
      }
      setIsConnecting(true);
      setError(null);
      (async () => {
        try {
          await GoogleAuthService.exchangeCodeForTokens(code, redirectUri, clientId, request?.codeVerifier);
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

  // ── Electron OAuth response ────────────────────────────────────────────────
  // On Electron, the system browser redirects to sign2sign://oauth?code=...
  // main.js catches the protocol URL and forwards it here via IPC.
  useEffect(() => {
    if (!isElectron || !window.electron) return;
    return window.electron.onOAuthCallback((url: string) => {
      const parsed = new URL(url);
      const code = parsed.searchParams.get('code');
      if (!code) {
        setError('No authorisation code received from Google.');
        return;
      }
      // Use the exact redirect URI the auth request was built with.
      // Google rejects the token exchange with redirect_uri_mismatch if this
      // differs by even a trailing slash from the one used in the authorize call.
      const redirectUri = request?.redirectUri;
      const clientId = request?.clientId;
      if (!redirectUri || !clientId) {
        setError('OAuth request not ready — try again.');
        return;
      }
      setIsConnecting(true);
      setError(null);
      (async () => {
        try {
          await GoogleAuthService.exchangeCodeForTokens(code, redirectUri, clientId, request?.codeVerifier);
          navigation.goBack();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Authentication failed');
        } finally {
          setIsConnecting(false);
        }
      })();
    });
  }, [request?.codeVerifier]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScreenHeader title="Connect Google" onBack={() => navigation.goBack()} variant="admin" />

      <View style={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={styles.title}>Connect Google Account</Text>
        <Text style={styles.body}>
          Sign2Sign imports jobs directly from Google Sheets. Connect your Google
          account once and your spreadsheets will be accessible for import.
        </Text>

        <AdminCard style={styles.scopeCard}>
          <Text style={styles.scopeLabel}>PERMISSIONS REQUESTED</Text>
          <Text style={styles.scopeItem}>• Read-only access to Google Sheets</Text>
          <Text style={styles.scopeNote}>
            Sign2Sign cannot modify your spreadsheets.
          </Text>
        </AdminCard>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <PrimaryButton
          label="Connect with Google"
          loading={isConnecting}
          disabled={!request}
          onPress={() => {
            // On Electron, popup windows are intercepted and opened in the system
            // browser by main.js's setWindowOpenHandler. promptAsync() would open a
            // popup that never resolves, so we open the auth URL directly instead.
            if (isElectron && request?.url && window.electron) {
              void window.electron.openExternal(request.url);
            } else {
              void promptAsync();
            }
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },

  content: { flex: 1, paddingHorizontal: 24, paddingTop: 32 },
  title: { fontSize: 22, fontWeight: '700', color: colors.adminText, marginBottom: 12 },
  body: { fontSize: 15, color: colors.adminTextSecondary, lineHeight: 22, marginBottom: 28 },

  scopeCard: { marginBottom: 28 },
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
});
