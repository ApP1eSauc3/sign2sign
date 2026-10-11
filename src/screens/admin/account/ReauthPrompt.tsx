import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '../../../utils/colors';
import { TextInputField } from '../../components/TextInputField';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ReauthKind, normaliseTotpInput } from './twoStep.logic';

// Shown in place of an action's button when the server answered
// reauth_required / mfa_required (sudo mode, see _shared/recentAuth.ts).
// The parent re-runs the action after onConfirm succeeds.
type Props = {
  kind: ReauthKind;
  message: string;
  // Resolves to an error message to show, or null on success.
  onConfirm: (value: string) => Promise<string | null>;
  onCancel: () => void;
};

export function ReauthPrompt({ kind, message, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const err = await onConfirm(value);
    setBusy(false);
    if (err) {
      setError(err);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  const isCode = kind === 'code';
  return (
    <View style={styles.box} accessibilityLiveRegion="polite">
      <Text style={styles.title}>Confirm it's you</Text>
      <Text style={styles.body}>{message}</Text>
      <TextInputField
        label={isCode ? 'Authenticator code' : 'Your password'}
        placeholder={isCode ? '123456' : 'Password'}
        value={value}
        onChangeText={isCode ? (t) => setValue(normaliseTotpInput(t)) : setValue}
        secureTextEntry={!isCode}
        keyboardType={isCode ? 'number-pad' : 'default'}
        maxLength={isCode ? 6 : undefined}
        textContentType={isCode ? 'oneTimeCode' : 'password'}
        autoComplete={isCode ? 'one-time-code' : 'current-password'}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        returnKeyType="go"
        onSubmitEditing={submit}
        accessibilityLabel={isCode ? 'Authenticator code' : 'Your password'}
        error={error ?? undefined}
      />
      <View style={styles.row}>
        <PrimaryButton
          label="Cancel"
          variant="outlineNeutral"
          size="admin"
          disabled={busy}
          onPress={onCancel}
          style={{ flex: 1 }}
        />
        <PrimaryButton
          label="Confirm"
          size="admin"
          disabled={busy || value.length === 0}
          loading={busy}
          onPress={submit}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: colors.adminCardBorder,
    backgroundColor: colors.adminSurface,
    borderRadius: 12,
    padding: 16,       // DESIGN §1.3
    marginTop: 8,
  },
  title: { fontSize: 15, fontWeight: '700', color: colors.adminText, marginBottom: 4 },
  body: { fontSize: 14, color: colors.adminTextSecondary, lineHeight: 20, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 12 },
});
