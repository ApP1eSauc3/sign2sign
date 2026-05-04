import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAppStore } from '../stores/useAppStore';
import { AppMode } from '../data/SignJob';
import { AuthService } from '../services/AuthService';
import { supabase } from '../services/supabaseClient';
import { colors } from '../utils/colors';
import ModeSelectScreen from '../screens/ModeSelectScreen';
import AdminStack from './AdminStack';
import DriverStack from './DriverStack';

export default function AppNavigator() {
  const { mode, setMode } = useAppStore();
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  // On mount: check for a persisted admin session and route directly to dashboard
  useEffect(() => {
    AuthService.getSession().then((session) => {
      if (session) setMode(AppMode.AdminAuthenticated);
      setIsRestoringSession(false);
    });

    // Also listen for auth state changes (token expiry, sign-out from another tab)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session && mode === AppMode.AdminAuthenticated) {
        setMode(AppMode.Undecided);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (isRestoringSession) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {mode === AppMode.Undecided && <ModeSelectScreen />}
      {mode === AppMode.AdminAuthenticated && <AdminStack />}
      {mode === AppMode.DriverActive && <DriverStack />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
