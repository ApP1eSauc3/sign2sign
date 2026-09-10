import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AdminLoginScreen from '../screens/admin/AdminLoginScreen';
import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import AdminRouteDetailScreen from '../screens/admin/AdminRouteDetailScreen';
import GoogleConnectScreen from '../screens/admin/GoogleConnectScreen';
import AccountScreen from '../screens/admin/AccountScreen';
import SetPasswordScreen from '../screens/admin/SetPasswordScreen';

export type AdminStackParamList = {
  AdminLogin: undefined;
  AdminDashboard: undefined;
  AdminRouteDetail: { routeCodeId: string; driverSlot: number; code: string };
  GoogleConnect: undefined;
  Account: undefined;
  // `flow` picks which GoTrue token table the six-digit code is verified
  // against: 'recovery' for forgot-password, 'invite' for a first-time admin.
  // `email` pre-fills the field when the caller already knows it.
  SetPassword: { flow: 'recovery' | 'invite'; email?: string };
};

const Stack = createNativeStackNavigator<AdminStackParamList>();

export default function AdminStack() {
  return (
    <Stack.Navigator initialRouteName="AdminLogin" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AdminLogin" component={AdminLoginScreen} />
      <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
      <Stack.Screen name="AdminRouteDetail" component={AdminRouteDetailScreen} />
      <Stack.Screen name="GoogleConnect" component={GoogleConnectScreen} />
      <Stack.Screen name="Account" component={AccountScreen} />
      <Stack.Screen name="SetPassword" component={SetPasswordScreen} />
    </Stack.Navigator>
  );
}
