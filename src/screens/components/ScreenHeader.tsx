import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../../utils/colors';

interface ScreenHeaderProps {
  title?: string;
  onBack: () => void;
  subtitle?: string;
  trailing?: React.ReactNode;
  variant?: 'driver' | 'admin';
  backLabel?: string;
  boxed?: boolean;
  divider?: boolean;
}

export function ScreenHeader({
  title,
  onBack,
  subtitle,
  trailing,
  variant = 'admin',
  backLabel,
  boxed = false,
  divider = true,
}: ScreenHeaderProps) {
  const isDriver = variant === 'driver';
  const backContent = backLabel ? (
    <Text style={styles.backLabelText}>← {backLabel}</Text>
  ) : (
    <Text style={[styles.chevron, isDriver && styles.chevronDriver]}>‹</Text>
  );

  return (
    <View>
      <View style={styles.row}>
        <TouchableOpacity
          style={boxed ? styles.boxedButton : undefined}
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={backLabel ? `Back to ${backLabel}` : 'Back'}
        >
          {backContent}
        </TouchableOpacity>

        <View style={styles.center}>
          {title ? (
            <Text style={[styles.title, isDriver ? styles.titleDriver : styles.titleAdmin]}>
              {title}
            </Text>
          ) : null}
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>

        <View style={boxed ? styles.trailingSlotBoxed : styles.trailingSlot}>{trailing}</View>
      </View>
      {divider ? (
        <View style={[styles.divider, { backgroundColor: isDriver ? colors.border : colors.adminDivider }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,   // DESIGN §2.4 — standardized header padding (was 16/12 and 24/14 across screens)
    paddingVertical: 12,
  },
  chevron: {
    fontSize: 32,
    color: colors.brand,
    fontWeight: '300',
    width: 32,
    lineHeight: 32,
  },
  chevronDriver: {
    fontSize: 22,
    width: 22,
    lineHeight: 22,
  },
  backLabelText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.brand,
  },
  boxedButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    fontWeight: '700',
  },
  titleAdmin: {
    fontSize: 18,          // DESIGN §1.7 — section header
    color: colors.adminText,
  },
  titleDriver: {
    fontSize: 20,           // DESIGN §1.7 — reduced from 24 to fit trailing content
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.brand,
    letterSpacing: 1.2,
    marginTop: 2,
  },
  trailingSlot: {
    minWidth: 32,
    alignItems: 'flex-end',
  },
  trailingSlotBoxed: {
    alignItems: 'flex-end',
  },
  divider: {
    height: 1,
  },
});
