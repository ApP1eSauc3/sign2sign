import { View, Text, StyleSheet } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DriverStackParamList } from '../../navigation/DriverStack';
import { colors } from '../../utils/colors';

type Props = NativeStackScreenProps<DriverStackParamList, 'DriverMap'>;

// Web/desktop stub for the driver map.
//
// `react-native-maps` is native-only — it has no web entry and calls
// codegenNativeComponent at import time, which crashes the entire web bundle.
// Metro resolves this `.web.tsx` ahead of `DriverMapScreen.tsx` for the web
// build, so the real map (and react-native-maps) is never pulled into the
// Electron admin bundle. The driver flow is mobile-only, so this screen is
// never actually reached on desktop — it exists only to keep the bundle clean.
export default function DriverMapScreen(_props: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Map unavailable on desktop</Text>
      <Text style={styles.subtitle}>
        The route map is part of the driver app and runs on mobile only.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: 24,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
  },
});
