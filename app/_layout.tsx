// app/_layout.tsx
import { useEffect, useState } from 'react';
import { View, ActivityIndicator, Platform, Text, UIManager } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { requestTrackingPermissionsAsync } from 'expo-tracking-transparency';
import { initAppMode } from '../lib/appMode';
import { initDB } from '../lib/db';
import { checkForCatalogUpdate, downloadAndApplyCatalogUpdate } from '../lib/catalogUpdate';
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
        // 広告SDKの初期化はここでは行わない。スプラッシュ表示中に初期化すると、
        // SDKが掴むルートViewControllerが本来のUI階層になる前の状態になり、
        // 実機で画面下部の全幅がタッチを受け付けなくなる不具合が出た。
        // ATTの結果が確定した後に初期化する(下の useEffect を参照)。
        await initDB();
        await Promise.all([initTheme(), initLocale(), initUiPrefs(), initAppMode(), initLastScreen()]);
        void checkForCatalogUpdate(true).then(({ available, manifest }) => {
          if (available && manifest) return downloadAndApplyCatalogUpdate(manifest);
        }).catch(console.warn);
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
    // 順序: スプラッシュを閉じる -> ATTの許可要求 -> 広告SDKの初期化。
    // ATTより先に広告SDKを初期化すると、SDKが追跡許可の状態を確定前にキャッシュする
    // (Googleのガイダンスでも ATT を先に要求するよう案内されている)。
    // また初期化をUI表示後まで遅らせることで、SDKが本来のUI階層のルートVCを掴む。
    const initAds = () => {
      if (!mobileAds) return;
      mobileAds().initialize().catch((error) => console.warn('mobileAds initialize failed', error));
    };
    void SplashScreen.hideAsync().then(() => {
      if (initFailed) return;
      if (Platform.OS === 'ios') {
        setTimeout(() => {
          requestTrackingPermissionsAsync().catch(console.error).finally(initAds);
        }, 250);
        return;
      }
      initAds();
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
