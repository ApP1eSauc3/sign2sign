import { View, Text, TextInput, TextInputProps, StyleSheet } from 'react-native';
import { colors } from '../../utils/colors';

type Variant = 'standard' | 'compact' | 'driverCode';

interface TextInputFieldProps
  extends Pick<
    TextInputProps,
    | 'value'
    | 'onChangeText'
    | 'placeholder'
    | 'placeholderTextColor'
    | 'keyboardType'
    | 'autoCapitalize'
    | 'autoCorrect'
    | 'secureTextEntry'
    | 'returnKeyType'
    | 'onSubmitEditing'
    | 'maxLength'
    | 'textContentType'
    | 'autoComplete'
    | 'autoFocus'
    | 'accessibilityLabel'
    | 'accessibilityHint'
  > {
  label?: string;
  error?: string;
  variant?: Variant;
}

const DEFAULT_PLACEHOLDER_COLOR: Record<Variant, string> = {
  standard: colors.adminTextHint,
  compact: colors.adminTextTertiary,
  driverCode: colors.textDisabled,
};

const ERROR_COLOR: Record<Variant, string> = {
  standard: colors.adminError,
  compact: colors.adminError,
  driverCode: colors.statusFailed,
};

export function TextInputField({
  label,
  error,
  variant = 'standard',
  placeholderTextColor,
  ...inputProps
}: TextInputFieldProps) {
  return (
    <View style={styles.wrap}>
      {label ? <Text style={labelStyles[variant]}>{label}</Text> : null}
      <TextInput
        style={[inputStyles[variant], !!error && errorBorderStyles[variant]]}
        placeholderTextColor={placeholderTextColor ?? DEFAULT_PLACEHOLDER_COLOR[variant]}
        {...inputProps}
      />
      {error ? <Text style={[styles.error, { color: ERROR_COLOR[variant] }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {},
  error: {
    fontSize: 13,       // DESIGN §1.7 — caption/meta
    marginTop: 4,        // DESIGN §1.3
  },
});

const labelStyles = StyleSheet.create({
  standard: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.adminTextSecondary,
    marginBottom: 6,
  },
  compact: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.adminTextSecondary,
    marginBottom: 6,
  },
  driverCode: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 8,
  },
});

const inputStyles = StyleSheet.create({
  standard: {
    width: '100%',
    height: 56,               // DESIGN §3.4 — field ops minimum touch target
    borderWidth: 1,
    borderColor: colors.adminBorder,
    borderRadius: 8,           // DESIGN §1.6 — input radius
    paddingHorizontal: 16,
    fontSize: 16,
    color: colors.adminText,
    backgroundColor: colors.white,
    marginBottom: 20,
  },
  compact: {
    width: '100%',
    height: 44,
    borderWidth: 1,
    borderColor: colors.adminBorder,
    borderRadius: 8,           // DESIGN §1.6 — input radius
    paddingHorizontal: 12,
    fontSize: 14,
    color: colors.adminText,
    backgroundColor: colors.white,
    marginBottom: 10,
  },
  driverCode: {
    height: 80,
    backgroundColor: colors.surface,
    borderRadius: 12,          // DESIGN — intentional exception, giant numeric code entry
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: 36,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 12,
    marginBottom: 16,
  },
});

const errorBorderStyles = StyleSheet.create({
  standard: { borderColor: colors.adminError },
  compact: { borderColor: colors.adminError },
  driverCode: { borderColor: colors.statusFailed },
});
