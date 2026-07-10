// app/_layout.tsx
import { useEffect, useState } from 'react';
import { View, ActivityIndicator, LayoutAnimation, Platform, UIManager } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { requestTrackingPermissionsAsync } from 'expo-tracking-transparency';
import { initDB } from '../lib/db';
import { initTheme, useTheme } from '../lib/theme';
import { initLocale } from '../lib/i18n';
import { initUiPrefs } from '../lib/uiPrefs';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function RootLayout() {
  // initDB()/initTheme()/initLocale() 完了まで画面を出さない(getDB()が未初期化で落ちるのを防ぐ)
  const [ready, setReady] = useState(false);
  const { colors, isDark } = useTheme();

  useEffect(() => {
    initDB().then(() => Promise.all([initTheme(), initLocale(), initUiPrefs()])).then(() => setReady(true)).catch(console.error);
    // パーソナライズ広告(AdMob)のためのIDFAアクセス許可。iOSのみダイアログが出る(Androidは常にgranted)。
    if (Platform.OS === 'ios') {
      requestTrackingPermissionsAsync().catch(console.error);
    }
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {ready ? (
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}>
          <ActivityIndicator />
        </View>
      )}
    </GestureHandlerRootView>
  );
}
