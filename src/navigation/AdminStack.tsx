import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AdminLoginScreen from '../screens/admin/AdminLoginScreen';
import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import AdminRouteDetailScreen from '../screens/admin/AdminRouteDetailScreen';
import GoogleConnectScreen from '../screens/admin/GoogleConnectScreen';
import AccountScreen from '../screens/admin/AccountScreen';
import SetPasswordScreen from '../screens/admin/SetPasswordScreen';
import { useAppStore } from '../stores/useAppStore';
import { AppMode } from '../data/SignJob';

export type AdminStackParamList = {
  AdminLogin: undefined;
  AdminDashboard: undefined;
  AdminRouteDetail: { routeCodeId: string; driverSlot: number; code: string };
  GoogleConnect: undefined;
  Account: undefined;
  // `flow` picks which GoTrue token table the emailed code is verified
  // against: 'recovery' for forgot-password, 'invite' for a first-time admin.
  // `email` pre-fills the field when the caller already knows it.
  SetPassword: { flow: 'recovery' | 'invite'; email?: string };
};

const Stack = createNativeStackNavigator<AdminStackParamList>();

export default function AdminStack() {
  // The login form must only ever show while signed out (AdminPending). It
  // used to be the initial route unconditionally, so a RESTORED session
  // (AppNavigator sets AdminAuthenticated on mount) sat on the login form in
  // the authenticated mode. A password reset started from there was then
  // ejected to mode select on its deliberate sign-out, hiding the error.
  // Found in the live test on 2026-10-11.
  //
  // initialRouteName is read only when the navigator mounts. AppNavigator
  // keeps this stack mounted across Pending → Authenticated, so promotion
  // after login does not re-route here; the screens navigate themselves.
  const mode = useAppStore((s) => s.mode);
  const initialRoute = mode === AppMode.AdminAuthenticated ? 'AdminDashboard' : 'AdminLogin';

  return (
    <Stack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AdminLogin" component={AdminLoginScreen} />
      <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
      <Stack.Screen name="AdminRouteDetail" component={AdminRouteDetailScreen} />
      <Stack.Screen name="GoogleConnect" component={GoogleConnectScreen} />
      <Stack.Screen name="Account" component={AccountScreen} />
      <Stack.Screen name="SetPassword" component={SetPasswordScreen} />
    </Stack.Navigator>
  );
}
