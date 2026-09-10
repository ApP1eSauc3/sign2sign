import { useState, useEffect } from 'react';
import {
  View,
  Text,
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
import { ScreenHeader } from '../components/ScreenHeader';
import { AdminCard } from '../components/AdminCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { TextInputField } from '../components/TextInputField';
import { isLikelyEmail } from '../../utils/email';
import { styles } from './account/styles';

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

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  useEffect(() => {
    AuthService.getSession().then((session) => {
      setEmail(session?.user.email ?? null);
    });
  }, []);

  async function handleInvite() {
    if (isInviting) return;
    setInviteError(null);
    setInviteNotice(null);

    const target = inviteEmail.trim();
    if (!isLikelyEmail(target)) {
      setInviteError('Enter a valid email address.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);  // DESIGN §4 — primary CTA
    setIsInviting(true);
    const err = await AuthService.inviteAdmin(target);
    setIsInviting(false);

    if (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setInviteError(err.message);
      return;
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setInviteEmail('');
    setInviteNotice(
      `Invite sent to ${target}. They finish setting up by tapping ` +
      '"I have an invite code" on the login screen and entering the 6-digit ' +
      'code from their email.'
    );
  }

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

        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>ADMINS</Text>
        <AdminCard>
          <Text style={styles.inviteTitle}>Invite an admin</Text>
          <Text style={styles.inviteBody}>
            Public sign-up is disabled, so this is the only way to add
            another admin. They get an email with a 6-digit code and choose
            their own password — you never see or set it.
          </Text>

          <TextInputField
            label="Their email"
            placeholder="colleague@sign2site.com.au"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="go"
            onSubmitEditing={handleInvite}
            textContentType="emailAddress"
            autoComplete="email"
            accessibilityLabel="Email address to invite"
            value={inviteEmail}
            onChangeText={setInviteEmail}
            error={inviteError ?? undefined}
          />

          {inviteNotice && <Text style={styles.inviteNotice}>{inviteNotice}</Text>}

          <PrimaryButton
            label="Send invite"
            size="admin"
            disabled={isInviting}
            loading={isInviting}
            onPress={handleInvite}
            style={{ marginTop: 4 }}
          />
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
            everyone out of the dashboard — public sign-up is disabled, so
            no replacement can be created from the login screen. Invite a
            second admin above first, and check with your team.
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
