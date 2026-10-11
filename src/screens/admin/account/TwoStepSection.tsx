import { useState } from 'react';
import { View, Text, Image, Linking, Platform, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AuthService, MfaEnrollment } from '../../../services/AuthService';
import { colors } from '../../../utils/colors';
import { AdminCard } from '../../components/AdminCard';
import { PrimaryButton } from '../../components/PrimaryButton';
import { TextInputField } from '../../components/TextInputField';
import { formatSecret, normaliseTotpInput, qrImageUri } from './twoStep.logic';

// Optional authenticator-app sign-in for this admin (Liam, 2026-10-11).
// Once on, migration 018 makes the database itself refuse this admin's
// session until the code is entered, so this is real protection, not a UI gate.
type Props = {
  enabled: boolean | null;  // null while loading
  onChanged: (enabled: boolean) => void;
};

type Step = 'idle' | 'setup' | 'disabling';

export function TwoStepSection({ enabled, onChanged }: Props) {
  const [step, setStep] = useState<Step>('idle');
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStep('idle');
    setEnrollment(null);
    setCode('');
    setError(null);
  }

  async function start() {
    setBusy(true);
    setError(null);
    const result = await AuthService.startMfaEnrollment();
    setBusy(false);
    if ('message' in result) {
      setError(result.message);
      return;
    }
    setEnrollment(result);
    setStep('setup');
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = step === 'setup' && enrollment
      ? await AuthService.confirmMfaEnrollment(enrollment.factorId, code)
      : await AuthService.disableMfa(code);
    setBusy(false);
    if (err) {
      setError(err.message);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onChanged(step === 'setup');
    reset();
  }

  const codeField = (
    <TextInputField
      label="Code from the app"
      placeholder="123456"
      value={code}
      onChangeText={(t) => setCode(normaliseTotpInput(t))}
      keyboardType="number-pad"
      maxLength={6}
      textContentType="oneTimeCode"
      autoComplete="one-time-code"
      returnKeyType="go"
      onSubmitEditing={confirm}
      accessibilityLabel="Six-digit code from your authenticator app"
      error={error ?? undefined}
    />
  );

  return (
    <AdminCard>
      <Text style={styles.title}>Two-step sign-in</Text>
      <Text style={styles.status}>
        {enabled === null ? 'Checking…' : enabled ? 'On' : 'Off'}
      </Text>

      {step === 'idle' && (
        <>
          <Text style={styles.body}>
            {enabled
              ? 'Each sign-in asks for a 6-digit code from your authenticator app as well as your password.'
              : 'Ask for a 6-digit code from an authenticator app (such as Google Authenticator or 1Password) as well as your password. A stolen password alone then cannot open the dashboard.'}
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton
            label={enabled ? 'Turn off…' : 'Turn on'}
            variant={enabled ? 'outlineNeutral' : 'brand'}
            size="admin"
            disabled={busy || enabled === null}
            loading={busy}
            onPress={enabled ? () => { setStep('disabling'); setError(null); } : start}
          />
        </>
      )}

      {step === 'setup' && enrollment && (
        <>
          <Text style={styles.body}>
            1. In your authenticator app, add an account
            {Platform.OS === 'web' ? ' by scanning this code' : ' using the key below'}.
          </Text>
          {Platform.OS === 'web' ? (
            // SVG data URIs render on web/Electron only; native shows the key.
            <Image
              source={{ uri: qrImageUri(enrollment.qrCode) }}
              style={styles.qr}
              accessibilityLabel="QR code for your authenticator app"
            />
          ) : (
            <PrimaryButton
              label="Open authenticator app"
              variant="outlineNeutral"
              size="admin"
              onPress={() => Linking.openURL(enrollment.uri).catch(() => {
                setError('No authenticator app opened. Type the key below into it instead.');
              })}
              style={{ marginBottom: 12 }}
            />
          )}
          <Text style={styles.keyLabel}>Setup key</Text>
          <Text style={styles.key} selectable accessibilityLabel="Setup key">
            {formatSecret(enrollment.secret)}
          </Text>
          <Text style={styles.body}>2. Enter the 6-digit code the app shows.</Text>
          {codeField}
          <Row busy={busy} canConfirm={code.length === 6} confirmLabel="Turn on" onCancel={reset} onConfirm={confirm} />
        </>
      )}

      {step === 'disabling' && (
        <>
          <Text style={styles.body}>Enter a current code to turn two-step sign-in off.</Text>
          {codeField}
          <Row busy={busy} canConfirm={code.length === 6} confirmLabel="Turn off" onCancel={reset} onConfirm={confirm} />
        </>
      )}
    </AdminCard>
  );
}

function Row(props: { busy: boolean; canConfirm: boolean; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <View style={styles.row}>
      <PrimaryButton label="Cancel" variant="outlineNeutral" size="admin" disabled={props.busy} onPress={props.onCancel} style={{ flex: 1 }} />
      <PrimaryButton
        label={props.confirmLabel}
        size="admin"
        disabled={props.busy || !props.canConfirm}
        loading={props.busy}
        onPress={props.onConfirm}
        style={{ flex: 1 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '700', color: colors.adminText },  // DESIGN §1.7 — row primary
  status: { fontSize: 13, fontWeight: '600', color: colors.adminTextTertiary, marginTop: 4, marginBottom: 8 },
  body: { fontSize: 14, color: colors.adminTextSecondary, lineHeight: 20, marginBottom: 12 },
  error: { fontSize: 14, color: colors.adminError, marginBottom: 12 },
  qr: { width: 176, height: 176, alignSelf: 'center', marginBottom: 16, backgroundColor: colors.white },
  keyLabel: { fontSize: 12, fontWeight: '700', color: colors.adminTextTertiary, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 },
  key: { fontSize: 16, fontWeight: '600', color: colors.adminText, letterSpacing: 1, marginBottom: 16, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', gap: 12 },
});
