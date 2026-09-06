import { View, Text, TouchableOpacity } from 'react-native';
import { DailyCode } from '../../../data/SignJob';
import { AdminCard } from '../../components/AdminCard';
import { styles } from './styles';

type Props = {
  codes: DailyCode[];
  onOpenRoute: (code: DailyCode) => void;
};

export function ActiveRoutesList({ codes, onOpenRoute }: Props) {
  return (
    <>
      {/* ── Active Routes ───────────────────────────────────────────── */}
      <Text style={[styles.sectionLabel, { marginTop: 28 }]}>ACTIVE ROUTES</Text>
      <AdminCard>
        {codes.length === 0 ? (
          <Text style={styles.emptyText}>No active routes today.</Text>
        ) : (
          codes.map((c, i) => (
            <TouchableOpacity
              key={c.id}
              style={[
                styles.routeRow,
                i < codes.length - 1 && styles.routeRowBorder,
              ]}
              onPress={() => onOpenRoute(c)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Open route detail for Driver ${c.driverSlot}, code ${c.code.split('').join(' ')}, active`}
            >
              <View style={styles.routeSlotDot} />
              <View style={styles.routeRowContent}>
                <Text style={styles.routeSlotLabel}>Driver {c.driverSlot}</Text>
                <Text style={styles.routeCode}>{c.code}</Text>
              </View>
              <View style={styles.routeRowRight}>
                <View style={styles.routeActiveBadge}>
                  <Text style={styles.routeActiveBadgeText}>ACTIVE</Text>
                </View>
                <Text style={styles.routeChevron} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">›</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </AdminCard>
    </>
  );
}
