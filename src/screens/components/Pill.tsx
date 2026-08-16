import { View, Text, StyleSheet } from 'react-native';

interface PillProps {
  label: string;
  color: string;
  backgroundColor?: string;
  variant?: 'filled' | 'outline';
}

export function Pill({ label, color, backgroundColor, variant = 'filled' }: PillProps) {
  return (
    <View
      style={[
        styles.pill,
        variant === 'filled'
          ? { backgroundColor }
          : { borderWidth: 1, borderColor: color },
      ]}
    >
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 8,   // DESIGN §1.3
    paddingVertical: 3,
    borderRadius: 99,       // DESIGN §1.6 — badge/pill capsule
  },
  label: {
    fontSize: 11,           // DESIGN §1.7 — badge/micro
    fontWeight: '600',
    letterSpacing: 0.8,
  },
});
