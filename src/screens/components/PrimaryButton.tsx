import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { colors } from '../../utils/colors';

type Variant = 'brand' | 'destructive' | 'outlineDestructive' | 'outlineNeutral';
type Size = 'standard' | 'admin' | 'gloved';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

const SIZE_HEIGHT: Record<Size, number> = {
  standard: 56,   // DESIGN §1.8 — primary action
  admin: 48,      // DESIGN §1.8 — admin primary (office context)
  gloved: 64,     // DESIGN §1.8 — advancing CTA, gloved-hand minimum
};

const SIZE_TYPE: Record<Size, { fontSize: number; fontWeight: '600' | '700' }> = {
  standard: { fontSize: 16, fontWeight: '600' },
  admin: { fontSize: 15, fontWeight: '600' },
  gloved: { fontSize: 17, fontWeight: '700' },
};

// Disabled state is token-only — never opacity (CLAUDE.md §1.5/§6 guardrail).
// `gloved` buttons only ever appear on the dark driver screens; `standard`/`admin`
// only ever appear on the light admin screens — so size alone determines the
// correct disabled-token pair, no separate theme prop needed.
const DISABLED_TOKENS: Record<Size, { bg: string; text: string }> = {
  gloved: { bg: colors.surfaceActive, text: colors.textDisabled },
  standard: { bg: colors.adminDivider, text: colors.adminTextHint },
  admin: { bg: colors.adminDivider, text: colors.adminTextHint },
};

function enabledStyle(variant: Variant): { bg: string; text: string; border?: string } {
  switch (variant) {
    case 'brand':
      return { bg: colors.brand, text: colors.white };
    case 'destructive':
      return { bg: colors.adminError, text: colors.white };
    case 'outlineDestructive':
      return { bg: colors.white, text: colors.adminError, border: colors.adminError };
    case 'outlineNeutral':
      return { bg: colors.white, text: colors.adminText, border: colors.adminBorder };
  }
}

export function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'brand',
  size = 'standard',
  fullWidth = true,
  style,
}: PrimaryButtonProps) {
  const isInteractive = !disabled && !loading;
  const enabled = enabledStyle(variant);

  let bg = enabled.bg;
  let textColor = enabled.text;
  let borderColor = enabled.border;
  const type = SIZE_TYPE[size];
  // Destructive actions read as higher-emphasis regardless of size (matches
  // the original "Delete forever" confirm button, which was bolder than its
  // sibling Cancel/"Delete account…" buttons at the same admin size).
  const fontWeight = variant === 'destructive' ? '700' : type.fontWeight;

  if (loading) {
    // In-flight, not invalid — reads as active/busy, matches CLAUDE.md §3.1's
    // capturing/uploading treatment (brandPressed), not the flat disabled tokens.
    if (variant === 'brand') bg = colors.brandPressed;
  } else if (disabled) {
    const tokens = DISABLED_TOKENS[size];
    bg = tokens.bg;
    textColor = tokens.text;
    borderColor = undefined;
  }

  return (
    <TouchableOpacity
      style={[
        styles.button,
        { height: SIZE_HEIGHT[size], backgroundColor: bg },
        borderColor ? { borderWidth: 1, borderColor } : null,
        fullWidth && styles.fullWidth,
        style,
      ]}
      onPress={onPress}
      disabled={!isInteractive}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !isInteractive, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.label, { fontSize: type.fontSize, fontWeight, color: textColor }]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 8,   // DESIGN — standardized button radius (was 8/10/12 across screens)
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { width: '100%' },
  label: {},
});
