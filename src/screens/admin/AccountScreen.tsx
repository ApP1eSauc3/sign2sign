import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
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
import { ScreenHeader } from '../components/ScreenHeader';
import { AdminCard } from '../components/AdminCard';
import { PrimaryButton } from '../components/PrimaryButton';

type Props = NativeStackScreenProps<AdminStackParamList, 'Account'>;

// Privacy policy URL — keep in sync with PRIVACY.md hosting destination.
// Published via GitHub Pages off the public repo (2026-05-31). Migrate to
// https://sign2site.com.au/privacy once the customer's CMS hosts the policy.
const PRIVACY_POLICY_URL = 'https://app1esauc3.github.io/sign2sign/PRIVACY';


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
      <ScreenHeader
        title="Account"
        onBack={() => navigation.goBack()}
        variant="admin"
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      >
        <Text style={styles.sectionLabel}>SIGNED IN AS</Text>
        <AdminCard>
          <Text style={styles.emailValue}>{email ?? '—'}</Text>
        </AdminCard>

        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>PRIVACY</Text>
        <AdminCard>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
            activeOpacity={0.7}
            accessibilityRole="link"
            accessibilityLabel="View privacy policy"
            accessibilityHint="Opens the privacy policy in your browser"
          >
            <Text style={styles.linkLabel}>View privacy policy</Text>
            <Text style={styles.linkChevron} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">›</Text>
          </TouchableOpacity>
        </AdminCard>

        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>DANGER ZONE</Text>
        <AdminCard style={styles.dangerCard}>
          <Text style={styles.dangerTitle}>Delete account</Text>
          <Text style={styles.dangerBody}>
            Permanently deletes your admin email + password from our
            authentication system. You will be signed out immediately and
            won't be able to recover this account.
          </Text>
          <Text style={styles.dangerBody}>
            Routes and jobs you imported, plus the photos drivers
            captured against them, stay on the customer's records — they
            belong to the operating entity, not to you personally. If you
            also need those removed, email the customer's privacy
            contact.
          </Text>
          <Text style={styles.dangerBody}>
            If you are the only admin, deleting this account locks
            everyone out of the dashboard — new admin sign-up is
            disabled, and a replacement account can only be created by
            the system operator. Check with your team first.
          </Text>

          {!confirmArmed ? (
            <PrimaryButton
              label="Delete account…"
              variant="outlineDestructive"
              size="admin"
              onPress={handleArm}
              style={{ marginTop: 4 }}
            />
          ) : (
            <>
              <Text style={styles.confirmHint}>
                This will permanently delete your account. Tap "Delete
                forever" to confirm.
              </Text>
              <View style={styles.confirmRow}>
                <PrimaryButton
                  label="Cancel"
                  variant="outlineNeutral"
                  size="admin"
                  disabled={isDeleting}
                  onPress={() => setConfirmArmed(false)}
                  style={{ flex: 1 }}
                />
                <PrimaryButton
                  label="Delete forever"
                  variant="destructive"
                  size="admin"
                  disabled={isDeleting}
                  loading={isDeleting}
                  onPress={handleConfirmDelete}
                  style={{ flex: 1 }}
                />
              </View>
            </>
          )}
        </AdminCard>
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

  confirmHint: {
    fontSize: 13,
    color: colors.adminTextSecondary,
    marginBottom: 12,
  },
  confirmRow: { flexDirection: 'row', gap: 12 },
});
