// app/_layout.tsx
import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { initDB } from '../lib/db';
import { initTheme, useTheme } from '../lib/theme';
import { initLocale, t, useLocale } from '../lib/i18n';

export default function RootLayout() {
  // initDB()/initTheme()/initLocale() 完了まで画面を出さない(getDB()が未初期化で落ちるのを防ぐ)
  const [ready, setReady] = useState(false);
  const { colors, isDark } = useTheme();
  useLocale();

  useEffect(() => {
    initDB().then(() => Promise.all([initTheme(), initLocale()])).then(() => setReady(true)).catch(console.error);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {ready ? (
        <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="paint/[id]" options={{ title: t('paintDetailTitle'), headerBackTitle: '' }} />
        </Stack>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}>
          <ActivityIndicator />
        </View>
      )}
    </GestureHandlerRootView>
  );
}
