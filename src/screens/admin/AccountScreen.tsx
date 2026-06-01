import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Linking,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { AuthService } from '../../services/AuthService';
import { useAppStore } from '../../stores/useAppStore';
import { AppMode } from '../../data/SignJob';
import { colors } from '../../utils/colors';

type Props = NativeStackScreenProps<AdminStackParamList, 'Account'>;

// Privacy policy URL — keep in sync with PRIVACY.md hosting destination.
// Published via GitHub Pages off the public repo (2026-05-31). Migrate to
// https://sign2site.com.au/privacy once the customer's CMS hosts the policy.
const PRIVACY_POLICY_URL = 'https://app1esauc3.github.io/sign2sign/PRIVACY';

// Required confirmation phrase before the destructive button enables.
const CONFIRM_PHRASE_LABEL = 'tapping the button twice';

export default function AccountScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const setMode = useAppStore((s) => s.setMode);

  const [email, setEmail] = useState<string | null>(null);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    AuthService.getSession().then((session) => {
      setEmail(session?.user.email ?? null);
    });
  }, []);

  async function handleArm() {
    if (isDeleting) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);  // DESIGN §4 — primary CTA
    setConfirmArmed(true);
  }

  async function handleConfirmDelete() {
    if (isDeleting) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);  // DESIGN §4 — destructive
    setIsDeleting(true);
    const err = await AuthService.deleteAccount();
    setIsDeleting(false);
    if (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Could not delete account', err.message);
      return;
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Drop back to the mode-select root. The session is already cleared in
    // AuthService.deleteAccount — switching mode is the visible signal.
    setMode(AppMode.Undecided);
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}  // DESIGN §3.4 — icon hit slop
        >
          <Text style={styles.backChevron}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Account</Text>
        {/* Spacer so the title stays optically centred against the back chevron. */}
        <View style={styles.headerSpacer} />
      </View>
      <View style={styles.divider} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      >
        <Text style={styles.sectionLabel}>SIGNED IN AS</Text>
        <View style={styles.sectionCard}>
          <Text style={styles.emailValue}>{email ?? '—'}</Text>
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>PRIVACY</Text>
        <View style={styles.sectionCard}>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
            activeOpacity={0.7}
          >
            <Text style={styles.linkLabel}>View privacy policy</Text>
            <Text style={styles.linkChevron}>›</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>DANGER ZONE</Text>
        <View style={[styles.sectionCard, styles.dangerCard]}>
          <Text style={styles.dangerTitle}>Delete account</Text>
          <Text style={styles.dangerBody}>
            Permanently deletes your admin login. You will be signed out
            immediately and won't be able to recover this account.
          </Text>
          <Text style={styles.dangerBody}>
            Routes and jobs you imported stay on the customer's records —
            they belong to the operating entity, not to you personally. If
            you also need those removed, contact your administrator.
          </Text>

          {!confirmArmed ? (
            <TouchableOpacity
              style={styles.armButton}
              onPress={handleArm}
              activeOpacity={0.8}
            >
              <Text style={styles.armButtonText}>Delete account…</Text>
            </TouchableOpacity>
          ) : (
            <>
              <Text style={styles.confirmHint}>
                Confirm by {CONFIRM_PHRASE_LABEL}. This cannot be undone.
              </Text>
              <View style={styles.confirmRow}>
                <TouchableOpacity
                  style={[styles.cancelButton, isDeleting && styles.buttonDisabled]}
                  onPress={() => setConfirmArmed(false)}
                  disabled={isDeleting}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmButton, isDeleting && styles.buttonDisabled]}
                  onPress={handleConfirmDelete}
                  disabled={isDeleting}
                  activeOpacity={0.8}
                >
                  {isDeleting ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <Text style={styles.confirmButtonText}>Delete forever</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,  // DESIGN §1.3 — standard page margin
    paddingVertical: 12,
  },
  backChevron: {
    fontSize: 32,
    color: colors.brand,
    fontWeight: '300',
    width: 32,
    lineHeight: 32,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.adminText },  // DESIGN §1.7 — section header
  headerSpacer: { width: 32 },
  divider: { height: 1, backgroundColor: colors.adminDivider },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 24 },  // DESIGN §1.3

  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.adminTextTertiary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  sectionCard: {
    backgroundColor: colors.adminSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.adminDivider,
    padding: 16,  // DESIGN §1.3
  },
  emailValue: { fontSize: 16, fontWeight: '600', color: colors.adminText },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
  },
  linkLabel: { fontSize: 15, color: colors.adminText, fontWeight: '500' },
  linkChevron: { fontSize: 18, color: colors.adminTextTertiary, fontWeight: '400' },

  dangerCard: { borderColor: colors.adminError, backgroundColor: colors.white },
  dangerTitle: {
    fontSize: 17,  // DESIGN §1.7 — row primary
    fontWeight: '700',
    color: colors.adminError,
    marginBottom: 8,
  },
  dangerBody: {
    fontSize: 14,
    color: colors.adminTextSecondary,
    lineHeight: 20,
    marginBottom: 12,
  },

  armButton: {
    height: 48,  // DESIGN §1.8 — admin primary button
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.adminError,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  armButtonText: { color: colors.adminError, fontSize: 15, fontWeight: '600' },

  confirmHint: {
    fontSize: 13,
    color: colors.adminTextSecondary,
    marginBottom: 12,
  },
  confirmRow: { flexDirection: 'row', gap: 12 },
  cancelButton: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.adminBorder,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: { color: colors.adminText, fontSize: 15, fontWeight: '600' },
  confirmButton: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.adminError,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  buttonDisabled: { opacity: 0.4 },
});
