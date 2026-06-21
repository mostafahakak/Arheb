import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { useAuth } from '../context/AuthContext';
import { StoreProvider } from '../context/StoreContext';
import { useLocale } from '../i18n';
import { colors } from '../theme';
import { Loader } from '../components/ui';

import LoginScreen from '../screens/LoginScreen';
import OrdersScreen from '../screens/OrdersScreen';
import OrderDetailScreen from '../screens/OrderDetailScreen';
import MyStoreScreen from '../screens/MyStoreScreen';
import ProductsScreen from '../screens/ProductsScreen';
import ProductFormScreen from '../screens/ProductFormScreen';
import ArhebBoxScreen from '../screens/ArhebBoxScreen';
import ActivityLogScreen from '../screens/ActivityLogScreen';
import AccountScreen from '../screens/AccountScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

/** Text tab icons — avoids expo-font / @expo/vector-icons (crashes in some Expo Go builds). */
const TAB_ICON = {
  Orders: '☰',
  Products: '◫',
  MyStore: '⌂',
  More: '⋯',
};

function OrdersStack() {
  const { t } = useLocale();
  return (
    <Stack.Navigator screenOptions={defaultStackOptions}>
      <Stack.Screen name="OrdersList" component={OrdersScreen} options={{ title: t('orders') }} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: t('order') }} />
    </Stack.Navigator>
  );
}

function ProductsStack() {
  const { t } = useLocale();
  return (
    <Stack.Navigator screenOptions={defaultStackOptions}>
      <Stack.Screen name="ProductsList" component={ProductsScreen} options={{ title: t('products') }} />
      <Stack.Screen name="ProductForm" component={ProductFormScreen} options={{ title: t('editProduct') }} />
    </Stack.Navigator>
  );
}

function MoreStack() {
  const { t } = useLocale();
  return (
    <Stack.Navigator screenOptions={defaultStackOptions}>
      <Stack.Screen name="Account" component={AccountScreen} options={{ title: t('account') }} />
      <Stack.Screen name="ArhebBox" component={ArhebBoxScreen} options={{ title: t('arhebBox') }} />
      <Stack.Screen name="ActivityLog" component={ActivityLogScreen} options={{ title: t('activityLog') }} />
    </Stack.Navigator>
  );
}

const defaultStackOptions = {
  headerStyle: { backgroundColor: colors.ink },
  headerTintColor: '#fff',
  headerTitleStyle: { fontWeight: '700' },
};

function Tabs() {
  const { t } = useLocale();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { borderTopColor: colors.border, height: 60, paddingBottom: 8, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarIcon: ({ color, focused }) => (
          <Text style={{ fontSize: 22, color, fontWeight: focused ? '700' : '400', lineHeight: 24 }}>
            {TAB_ICON[route.name] || '•'}
          </Text>
        ),
      })}
    >
      <Tab.Screen name="Orders" component={OrdersStack} options={{ title: t('orders') }} />
      <Tab.Screen name="Products" component={ProductsStack} options={{ title: t('products') }} />
      <Tab.Screen name="MyStore" component={MyStoreScreen} options={{ title: t('myStore') }} />
      <Tab.Screen name="More" component={MoreStack} options={{ title: t('account') }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { admin, loading } = useAuth();
  if (loading) return <Loader />;
  return (
    <NavigationContainer>
      {admin ? (
        <StoreProvider>
          <Tabs />
        </StoreProvider>
      ) : (
        <LoginScreen />
      )}
    </NavigationContainer>
  );
}
