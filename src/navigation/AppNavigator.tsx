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
import { formatDocumentTitle } from './documentTitle';

export default function AppNavigator() {
  // Atomic selector: this component re-renders only when `mode` changes, which
  // is the only store value it renders. `useAppStore()` with no selector
  // subscribes to the whole store and re-renders the entire navigator — and
  // with it every mounted screen — on any state change.
  const mode = useAppStore((s) => s.mode);
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  // On mount: check for a persisted admin session and route directly to dashboard
  useEffect(() => {
    // Read actions off the store rather than closing over them. This effect runs
    // once (deps: []), so anything captured from the render scope is frozen at
    // its first value for the lifetime of the listener below.
    const { setMode } = useAppStore.getState();

    // A restored session for an admin with two-step sign-in on can be stuck
    // at aal1 (they closed the app on the code screen). It is not treated as
    // signed in: the mode stays Undecided, so the next admin sign-in goes
    // through the code screen again. The database refuses aal1 for that admin
    // regardless (migration 018).
    AuthService.getSession().then(async (session) => {
      if (session && !(await AuthService.needsMfaChallenge())) setMode(AppMode.AdminAuthenticated);
      setIsRestoringSession(false);
    });

    // Also listen for auth state changes (token expiry, sign-out from another tab)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // getState() at call time, NOT the `mode` from the render scope.
      //
      // This was a live bug: the effect has an empty dep array, so the closure
      // captured `mode` as AppMode.Undecided — its value on first render — and
      // never saw an update. The condition below could therefore never be true,
      // and an expired token or a sign-out elsewhere left the admin sitting on
      // the dashboard with a dead session until they restarted the app.
      //
      // AdminPending is deliberately not matched. A pre-login screen that loses
      // a session (SetPasswordScreen signs out when updateUser refuses the
      // password) must stay put and show why. Matching it here once hid every
      // such error behind an unexplained jump to mode select (2026-10-10).
      if (!session && useAppStore.getState().mode === AppMode.AdminAuthenticated) {
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
    <NavigationContainer documentTitle={{ formatter: formatDocumentTitle }}>
      {mode === AppMode.Undecided && <ModeSelectScreen />}
      {/* One expression for both admin modes, so promoting Pending →
          Authenticated keeps the same AdminStack mounted instead of
          remounting it and dropping the navigation state. */}
      {(mode === AppMode.AdminPending || mode === AppMode.AdminAuthenticated) && <AdminStack />}
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
