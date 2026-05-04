import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AdminLoginScreen from '../screens/admin/AdminLoginScreen';
import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import AdminRouteDetailScreen from '../screens/admin/AdminRouteDetailScreen';
import GoogleConnectScreen from '../screens/admin/GoogleConnectScreen';

export type AdminStackParamList = {
  AdminLogin: undefined;
  AdminDashboard: undefined;
  AdminRouteDetail: { routeCodeId: string; driverSlot: number; code: string };
  GoogleConnect: undefined;
};

const Stack = createNativeStackNavigator<AdminStackParamList>();

export default function AdminStack() {
  return (
    <Stack.Navigator initialRouteName="AdminLogin" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AdminLogin" component={AdminLoginScreen} />
      <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
      <Stack.Screen name="AdminRouteDetail" component={AdminRouteDetailScreen} />
      <Stack.Screen name="GoogleConnect" component={GoogleConnectScreen} />
    </Stack.Navigator>
  );
}
