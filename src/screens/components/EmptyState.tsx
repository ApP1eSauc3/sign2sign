import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../utils/colors';

interface EmptyStateProps {
  title: string;
  hint?: string;
  variant?: 'driver' | 'admin';
}

export function EmptyState({ title, hint, variant = 'driver' }: EmptyStateProps) {
  const titleColor = variant === 'driver' ? colors.textSecondary : colors.adminTextTertiary;
  const hintColor = variant === 'driver' ? colors.textDisabled : colors.adminTextHint;

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: titleColor }]}>{title}</Text>
      {hint ? <Text style={[styles.hint, { color: hintColor }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 48,          // DESIGN §1.3 — breathing room
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  title: {
    fontSize: 17,            // DESIGN §1.7 — row primary
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  hint: {
    fontSize: 13,            // DESIGN §1.7 — caption/meta, standardized (was 15/14/13 across screens)
    textAlign: 'center',
    lineHeight: 20,
  },
});
