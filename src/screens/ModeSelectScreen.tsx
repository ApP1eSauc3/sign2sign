import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../stores/useAppStore';
import { AppMode } from '../data/SignJob';
import { colors } from '../utils/colors';

export default function ModeSelectScreen() {
  const insets = useSafeAreaInsets();
  const setMode = useAppStore((s) => s.setMode);

  return (
    <View style={styles.root}>
      {/* Full-bleed brand hero — brand rule: blue fills the block, white on top */}
      <View style={[styles.hero, { paddingTop: insets.top + 60 }]}>
        <Text style={styles.wordmark}>S2S</Text>
        <Text style={styles.wordmarkSub}>SIGN2SIGN</Text>
        <Text style={styles.tagline}>Making every sign a landmark.</Text>
      </View>

      {/* Mode selection card */}
      <View style={[styles.card, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={styles.cardTitle}>Who are you?</Text>

        {/* Admin — brand blue, leads into the admin (light) world.
            NOTE: Mode is set to AdminAuthenticated here so AppNavigator renders
            AdminStack. AdminStack always starts at AdminLogin — auth hasn't
            actually happened yet at this point. If AppMode semantics are tightened
            in future, add an AdminPending mode and gate dashboard access on it. */}
        <TouchableOpacity
          style={[styles.button, styles.buttonAdmin]}
          onPress={() => setMode(AppMode.AdminAuthenticated)}
          activeOpacity={0.85}
        >
          <Text style={styles.buttonAdminText}>Admin</Text>
          <Text style={styles.buttonAdminSub}>Manage routes and jobs</Text>
        </TouchableOpacity>

        {/* Driver — dark, leads into the driver (dark) world */}
        <TouchableOpacity
          style={[styles.button, styles.buttonDriver]}
          onPress={() => setMode(AppMode.DriverActive)}
          activeOpacity={0.85}
        >
          <Text style={styles.buttonDriverText}>Driver</Text>
          <Text style={styles.buttonDriverSub}>Enter your daily code</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.brand,
  },

  // Hero — brand blue fills entirely
  hero: {
    flex: 1,
    paddingHorizontal: 32,
    paddingBottom: 48,
    justifyContent: 'flex-end',
  },
  wordmark: {
    fontSize: 56,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: -1,
  },
  wordmarkSub: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.white,
    letterSpacing: 3,
    opacity: 0.8,
    marginTop: -4,
    marginBottom: 20,
  },
  tagline: {
    fontSize: 17,
    fontWeight: '400',
    color: colors.white,
    opacity: 0.85,
    lineHeight: 24,
  },

  // Card — white panel slides up from bottom
  card: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.adminTextTertiary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 16,
  },

  // Shared button
  button: {
    width: '100%',
    height: 72,
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: 'center',
    marginBottom: 12,
  },

  // Admin button — brand blue solid
  buttonAdmin: {
    backgroundColor: colors.brand,
  },
  buttonAdminText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.white,
  },
  buttonAdminSub: {
    fontSize: 13,
    color: colors.white,
    opacity: 0.8,
    marginTop: 2,
  },

  // Driver button — dark, hints at the dark world they're entering
  buttonDriver: {
    backgroundColor: colors.bg,
  },
  buttonDriverText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  buttonDriverSub: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
