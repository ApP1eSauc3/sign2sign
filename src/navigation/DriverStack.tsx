import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DriverCodeScreen from '../screens/driver/DriverCodeScreen';
import DriverMapScreen from '../screens/driver/DriverMapScreen';
import DriverRouteScreen from '../screens/driver/DriverRouteScreen';
import DriverJobScreen from '../screens/driver/DriverJobScreen';

export type DriverStackParamList = {
  DriverCode: undefined;
  DriverMap: undefined;    // primary landing screen after code entry
  DriverRoute: undefined;  // list view — accessible from map via "≡ List"
  DriverJob: { jobId: string };
};

const Stack = createNativeStackNavigator<DriverStackParamList>();

export default function DriverStack() {
  return (
    <Stack.Navigator initialRouteName="DriverCode" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DriverCode" component={DriverCodeScreen} />
      <Stack.Screen name="DriverMap" component={DriverMapScreen} />
      <Stack.Screen name="DriverRoute" component={DriverRouteScreen} />
      <Stack.Screen name="DriverJob" component={DriverJobScreen} />
    </Stack.Navigator>
  );
}
