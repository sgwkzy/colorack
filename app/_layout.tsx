// app/_layout.tsx
import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { initDB } from '../lib/db';
import { initTheme, useTheme } from '../lib/theme';

export default function RootLayout() {
  // initDB()/initTheme() 完了まで画面を出さない(getDB()が未初期化で落ちるのを防ぐ)
  const [ready, setReady] = useState(false);
  const { isDark } = useTheme();

  useEffect(() => {
    initDB().then(() => initTheme()).then(() => setReady(true)).catch(console.error);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {ready ? (
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      )}
    </GestureHandlerRootView>
  );
}
