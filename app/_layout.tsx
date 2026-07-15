// app/_layout.tsx
import { useEffect, useState } from 'react';
import { View, ActivityIndicator, LayoutAnimation, Platform, Text, UIManager } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { requestTrackingPermissionsAsync } from 'expo-tracking-transparency';
import { initAppMode } from '../lib/appMode';
import { initDB } from '../lib/db';
import { initTheme, useTheme } from '../lib/theme';
import { initLocale } from '../lib/i18n';
import { initLastScreen } from '../lib/lastScreen';
import { initUiPrefs } from '../lib/uiPrefs';
import mobileAds from '../lib/mobileAds';

void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 200, fade: true });

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function RootLayout() {
  // initDB()/initTheme()/initLocale() 完了まで画面を出さない(getDB()が未初期化で落ちるのを防ぐ)
  const [ready, setReady] = useState(false);
  const [initFailed, setInitFailed] = useState(false);
  const { colors, isDark } = useTheme();

  useEffect(() => {
    const initialize = async () => {
      try {
        if (mobileAds) await mobileAds().initialize().catch(console.warn);
        await initDB();
        await Promise.all([initTheme(), initLocale(), initUiPrefs(), initAppMode(), initLastScreen()]);
      } catch (error) {
        console.error(error);
        setInitFailed(true);
      } finally {
        setReady(true);
      }
    };
    void initialize();
  }, []);

  useEffect(() => {
    if (!ready) return;
    void SplashScreen.hideAsync().then(() => {
      if (!initFailed && Platform.OS === 'ios') setTimeout(() => requestTrackingPermissionsAsync().catch(console.error), 250);
    });
  }, [initFailed, ready]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {initFailed ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}>
          <Text style={{ color: colors.text }}>アプリの初期化に失敗しました。再起動してください。</Text>
        </View>
      ) : ready ? (
        <Stack screenOptions={{ animation: 'none' }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}>
          <ActivityIndicator />
        </View>
      )}
    </SafeAreaProvider></GestureHandlerRootView>
  );
}
