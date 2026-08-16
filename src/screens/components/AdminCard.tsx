import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { colors } from '../../utils/colors';

interface AdminCardProps {
  children: React.ReactNode;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function AdminCard({ children, selected = false, style }: AdminCardProps) {
  return (
    <View style={[styles.card, selected && styles.selected, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.adminSurface,
    borderRadius: 12,               // DESIGN — standardized (was 10/12 across screens)
    borderWidth: 1,
    borderColor: colors.adminCardBorder,  // DESIGN — standardized (was adminDivider/adminCardBorder across screens)
    padding: 16,                    // DESIGN §1.3
  },
  selected: {
    borderColor: colors.brand,
    backgroundColor: colors.adminSelectedBg,
  },
});
