import { useState } from 'react';
import { View, Text, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { AuthService } from '../../services/AuthService';
import { useAppStore } from '../../stores/useAppStore';
import { AppMode } from '../../data/SignJob';
import { TextInputField } from '../components/TextInputField';
import { PrimaryButton } from '../components/PrimaryButton';
import {
  validateSetPassword,
  SetPasswordField,
  CODE_MAX_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_RULE_HINT,
} from './setPassword/logic';
import { styles } from './setPassword/styles';
import { normaliseTotpInput } from './account/twoStep.logic';

type Props = NativeStackScreenProps<AdminStackParamList, 'SetPassword'>;

// One screen serves both email-code flows, because after the code is in hand
// they are the same three fields and the same two API calls:
//
//   'recovery' — an admin who forgot their password. Starts at 'request': we
//                have to ask GoTrue to send the code before anything else.
//   'invite'   — a new admin whose code was already sent by whoever invited
//                them (invite-admin Edge Function). Starts at 'enter'; there
//                is nothing for this screen to request.
//
// Neither flow follows the link in the email. Both read the numeric
// {{ .Token }} out of it — see AuthService.completePasswordReset for why.
// 'mfa' (two-step sign-in on): the emailed code is spent, but Supabase will
// not change the password until the authenticator code lifts the session to aal2.
type Phase = 'request' | 'enter' | 'mfa';

export default function SetPasswordScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { flow } = route.params;
  const setMode = useAppStore((s) => s.setMode);

  const [phase, setPhase] = useState<Phase>(flow === 'invite' ? 'enter' : 'request');
  const [email, setEmail] = useState(route.params.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [fieldError, setFieldError] = useState<{ field: SetPasswordField; message: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function errorFor(field: SetPasswordField): string | undefined {
    return fieldError?.field === field ? fieldError.message : undefined;
  }

  async function handleRequestCode() {
    setFieldError(null);
    setFormError(null);

    const trimmed = email.trim();
    if (trimmed.length === 0) {
      setFieldError({ field: 'email', message: 'Enter the email the code was sent to.' });
      return;
    }

    setLoading(true);
    await AuthService.requestPasswordReset(trimmed);
    setLoading(false);

    // Success haptic, unconditionally — the request itself completed. This is
    // NOT a claim that an email was sent; AuthService deliberately cannot tell
    // us, and the wording below is careful to promise nothing more.
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setNotice(
      `If ${trimmed} has an admin account, a code is on its way. ` +
      'Codes expire — if yours stops working, request another.'
    );
    setPhase('enter');
  }

  async function handleSetPassword() {
    setFieldError(null);
    setFormError(null);

    const validation = validateSetPassword({ email, code, password, confirmPassword });
    if (!validation.ok) {
      setFieldError({ field: validation.field, message: validation.message });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    setLoading(true);
    const err = await AuthService.completePasswordReset({
      email,
      code,
      newPassword: password,
      type: flow,
    });
    setLoading(false);

    if (err?.code === 'mfa_required') {
      setNotice(err.message);
      setPhase('mfa');
      return;
    }
    await finish(err);
  }

  async function handleFinishWithMfa() {
    setFormError(null);
    setLoading(true);
    const err = await AuthService.completePasswordResetWithMfa({ totp, newPassword: password });
    setLoading(false);
    await finish(err);
  }

  async function finish(err: { message: string } | null) {
    if (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFormError(err.message);
      return;
    }

    // completePasswordReset leaves a live session behind (verifyOtp mints one),
    // so the dashboard is reachable directly — no trip back through login.
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // An emailed code proves the inbox, not the authenticator: an admin with
    // two-step sign-in on still owes the app code before the dashboard.
    if (await AuthService.needsMfaChallenge()) {
      navigation.replace('MfaChallenge');
      return;
    }
    setMode(AppMode.AdminAuthenticated);
    navigation.replace('AdminDashboard');
  }

  const isInvite = flow === 'invite';

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.header, { paddingTop: insets.top + 40 }]}>
        <Text style={styles.wordmark}>S2S</Text>
        <Text style={styles.wordmarkSub}>SIGN2SITE</Text>
      </View>

      <ScrollView
        style={styles.formScroll}
        contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.formTitle}>
          {isInvite ? 'Accept your invite' : 'Reset your password'}
        </Text>
        <Text style={styles.formIntro}>
          {isInvite
            ? `Enter the code from your invite email, then choose a password. ${PASSWORD_RULE_HINT}`
            : phase === 'request'
              ? "Enter your admin email and we'll send you a code."
              : `Enter the code from the email, then choose a new password. ${PASSWORD_RULE_HINT}`}
        </Text>

        {notice && (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        )}

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
          error={errorFor('email')}
        />

        {phase === 'mfa' && (
          <TextInputField
            label="Code from your authenticator app"
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={6}
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            autoFocus
            returnKeyType="go"
            onSubmitEditing={handleFinishWithMfa}
            accessibilityLabel="Six-digit code from your authenticator app"
            value={totp}
            onChangeText={(t) => setTotp(normaliseTotpInput(t))}
          />
        )}

        {phase === 'enter' && (
          <>
            <TextInputField
              label="Code from the email"
              placeholder="12345678"
              keyboardType="number-pad"
              maxLength={CODE_MAX_LENGTH}
              returnKeyType="next"
              // oneTimeCode surfaces the code in the iOS keyboard's QuickType bar
              // straight from the mail notification, so it never has to be typed.
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              accessibilityLabel="Code from the email"
              value={code}
              onChangeText={setCode}
              error={errorFor('code')}
            />

            <TextInputField
              label="New password"
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              secureTextEntry
              returnKeyType="next"
              // newPassword (not `password`) is what tells the iOS keychain and
              // password managers to *offer to generate and save* one here.
              textContentType="newPassword"
              autoComplete="new-password"
              accessibilityLabel="New password"
              value={password}
              onChangeText={setPassword}
              error={errorFor('password')}
            />

            <TextInputField
              label="Confirm new password"
              placeholder="Re-enter the password"
              secureTextEntry
              returnKeyType="go"
              onSubmitEditing={handleSetPassword}
              textContentType="newPassword"
              autoComplete="new-password"
              accessibilityLabel="Confirm new password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              error={errorFor('confirm')}
            />
          </>
        )}

        {formError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{formError}</Text>
          </View>
        )}

        {/* The single advancing action — its label is the next step, always */}
        <PrimaryButton
          label={phase === 'request' ? 'Send code' : phase === 'mfa' ? 'Finish' : 'Set password'}
          onPress={phase === 'request' ? handleRequestCode : phase === 'mfa' ? handleFinishWithMfa : handleSetPassword}
          loading={loading}
          // DESIGN §1.8 — 56pt (size="standard", the default), not the 48pt
          // admin height. Same intentional exception AdminLoginScreen carries:
          // an auth moment reads as higher-emphasis than a routine admin
          // action, and this screen sits directly beside that one.
          style={styles.button}
        />

        {/* Re-request is offered on the recovery path only: on the invite path
            this screen has no way to reissue a code — only another admin can,
            by inviting again. Offering a dead button would be worse than none. */}
        {phase === 'enter' && !isInvite && (
          <TouchableOpacity
            style={styles.linkButton}
            onPress={handleRequestCode}
            disabled={loading}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Send a new code"
          >
            <Text style={styles.linkText}>Send a new code</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Back to login"
        >
          <Text style={styles.linkText}>← Back to login</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
