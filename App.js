import React, { useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';
import { View } from 'react-native';

import { useFonts, Oswald_500Medium, Oswald_600SemiBold, Oswald_700Bold } from '@expo-google-fonts/oswald';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';

import { colors, type as fonts } from './src/theme/theme';
import { AppDataProvider, useAppData } from './src/context/AppDataContext';
import { SyncProvider } from './src/context/SyncContext';
import SetupScreen from './src/screens/SetupScreen';
import ScanScreen from './src/screens/ScanScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import ReportsScreen from './src/screens/ReportsScreen';

SplashScreen.preventAutoHideAsync().catch(() => {});

const Tab = createBottomTabNavigator();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bgElevated,
    border: colors.border,
    primary: colors.accent,
    text: colors.text,
  },
};

const TAB_ICONS = {
  Scan: 'scan-outline',
  Dashboard: 'stats-chart-outline',
  Reports: 'document-text-outline',
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        // Each tab screen slides in from the side it lives on.
        animation: 'shift',
        transitionSpec: { animation: 'timing', config: { duration: 260 } },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        // Tab bar: fixed-size icon "pill" slot for every tab (focused or
        // not) so nothing shifts when selection changes, equal flex per
        // item, consistent vertical rhythm, and the bar hides when the
        // keyboard is up so it never gets pushed into the middle of the
        // screen while typing Remarks / Phy. Qty.
        tabBarHideOnKeyboard: true,
        tabBarLabelPosition: 'below-icon',
        tabBarStyle: {
          backgroundColor: colors.bgElevated,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 66,
          paddingTop: 6,
          paddingBottom: 8,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarItemStyle: {
          flex: 1,
          paddingVertical: 0,
          justifyContent: 'center',
        },
        tabBarIconStyle: {
          marginBottom: 0,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.bodySemi,
          fontSize: 11,
          letterSpacing: 0.3,
          marginTop: 2,
          marginBottom: 0,
        },
        tabBarIcon: ({ color, focused }) => (
          <View style={[styles.tabPill, focused && styles.tabPillActive]}>
            <Ionicons
              name={focused ? TAB_ICONS[route.name].replace('-outline', '') : TAB_ICONS[route.name]}
              size={21}
              color={color}
            />
          </View>
        ),
      })}
    >
      <Tab.Screen name="Scan" component={ScanScreen} />
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Reports" component={ReportsScreen} />
    </Tab.Navigator>
  );
}

function Root() {
  const { ready, userName, bay, warehouse } = useAppData();

  if (!ready) return null;

  return (
    <NavigationContainer theme={navTheme}>
      {userName && bay && warehouse ? <MainTabs /> : <SetupScreen />}
    </NavigationContainer>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Oswald_500Medium, Oswald_600SemiBold, Oswald_700Bold,
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
    JetBrainsMono_500Medium, JetBrainsMono_700Bold,
  });

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) {
      await SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider onLayout={onLayoutRootView}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        <AppDataProvider>
          <SyncProvider>
            <Root />
          </SyncProvider>
        </AppDataProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  tabPill: {
    width: 56,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabPillActive: {
    backgroundColor: colors.accentSoft,
  },
});
