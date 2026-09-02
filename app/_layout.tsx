// app/_layout.tsx
import { useEffect, useState } from 'react';
import { View, ActivityIndicator, Alert, Platform, Text, UIManager } from 'react-native';
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
import { getLocale, initLocale, t } from '../lib/i18n';
import { getCurrentAuthUser, initAuth } from '../lib/auth';
import { fetchBackupSnapshot, initAutoBackup, markCloudBackupReady, pushBackupToFirestore, restoreFromSnapshot, runRestoreDecision } from '../lib/cloudBackup';
import { initAnalytics } from '../lib/analytics';
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
  const [startupConflictUid, setStartupConflictUid] = useState<string | null>(null);
  const [startupConflictKind, setStartupConflictKind] = useState<'cloud' | 'account' | null>(null);
  const [startupConflictDialogShown, setStartupConflictDialogShown] = useState(false);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const { colors, isDark } = useTheme();

  useEffect(() => {
    const initialize = async () => {
      try {
        // 広告SDKの初期化はここでは行わない。スプラッシュ表示中に初期化すると、
        // SDKが掴むルートViewControllerが本来のUI階層になる前の状態になり、
        // 実機で画面下部の全幅がタッチを受け付けなくなる不具合が出た。
        // ATTの結果が確定した後に初期化する(下の useEffect を参照)。
        await initDB();
        await Promise.all([
          initTheme(),
          initLocale(),
          initUiPrefs(),
          initAppMode(),
          initLastScreen(),
          // Firebase/RevenueCat/Google Play Servicesのネイティブ呼び出しに依存するため、
          // 実機で失敗する可能性がある。失敗してもカタログ閲覧・在庫管理といった
          // 認証と無関係なコア機能まで巻き込んでアプリ全体を起動不能にしないよう、
          // ここで握りつぶす(ready状態には遷移させる)。
          initAuth().catch((e) => console.error('initAuth: failed, continuing without auth', e)),
          initAnalytics().catch((e) => console.error('initAnalytics: failed, continuing without analytics', e)),
        ]);
        const restoreDecision = await runRestoreDecision().catch((e) => {
          console.error('RootLayout: failed initial restore decision', e);
          return 'none' as const;
        });
        if (restoreDecision === 'conflict' || restoreDecision === 'account_conflict') {
          setStartupConflictUid(getCurrentAuthUser()?.uid ?? null);
          setStartupConflictKind(restoreDecision === 'account_conflict' ? 'account' : 'cloud');
          setStartupConflictDialogShown(false);
        }
        initAutoBackup();
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
    if (!ready || !startupConflictUid || resolvingConflict || startupConflictDialogShown) return;
    const expectedUid = startupConflictUid;
    const clearConflict = () => {
      setStartupConflictUid(null);
      setStartupConflictKind(null);
      setStartupConflictDialogShown(false);
    };
    const resolveConflict = async (useCloud: boolean) => {
      setResolvingConflict(true);
      try {
        if (useCloud) {
          const snapshot = await fetchBackupSnapshot(expectedUid);
          if (!snapshot) throw new Error('Cloud backup disappeared during conflict resolution.');
          await restoreFromSnapshot(snapshot, expectedUid);
        }
        await markCloudBackupReady(expectedUid);
        if (!useCloud) await pushBackupToFirestore();
        clearConflict();
      } catch (e) {
        console.error('RootLayout: failed to resolve backup conflict', e);
        clearConflict();
        Alert.alert(t('error'), t('cloudBackupError'));
      } finally {
        setResolvingConflict(false);
      }
    };
    setStartupConflictDialogShown(true);
    if (startupConflictKind === 'account') {
      void fetchBackupSnapshot(expectedUid)
        .then((snapshot) => {
          if (!snapshot) {
            Alert.alert(
              getLocale() === 'ja' ? '別アカウントの端末データがあります' : 'This device has data from another account',
              getLocale() === 'ja'
                ? 'この端末のデータを現在のアカウントへ引き継ぐ場合だけ、バックアップを開始します。'
                : 'Backup starts only if you explicitly adopt this device data into the current account.',
              [
                { text: t('cancel'), style: 'cancel', onPress: clearConflict },
                { text: getLocale() === 'ja' ? 'この端末のデータを引き継ぐ' : 'Use this device data', onPress: () => { void resolveConflict(false); } },
              ],
              { cancelable: false }
            );
            return;
          }
          Alert.alert(
            getLocale() === 'ja' ? '別アカウントの端末データがあります' : 'This device has data from another account',
            getLocale() === 'ja'
              ? 'クラウドから復元すると端末データは置き換わります。端末データを引き継ぐと、現在のクラウドバックアップを上書きします。'
              : 'Restoring from cloud replaces this device data. Adopting this device data overwrites the current cloud backup.',
            [
              { text: t('cloudRestoreFromCloud'), style: 'destructive', onPress: () => { void resolveConflict(true); } },
              { text: getLocale() === 'ja' ? '端末データを引き継ぎ（クラウドを上書き）' : 'Adopt device data (overwrite cloud)', onPress: () => { void resolveConflict(false); } },
              { text: t('cancel'), style: 'cancel', onPress: clearConflict },
            ],
            { cancelable: false }
          );
        })
        .catch((e) => {
          console.error('RootLayout: failed to inspect account conflict', e);
          clearConflict();
          Alert.alert(t('error'), t('cloudBackupError'));
        });
      return;
    }
    Alert.alert(t('cloudRestoreConflictTitle'), t('cloudRestoreConflictMessage'), [
      {
        text: t('cloudRestoreFromCloud'),
        style: 'destructive',
        onPress: () => { void resolveConflict(true); },
      },
      {
        text: t('cloudKeepDeviceData'),
        onPress: () => { void resolveConflict(false); },
      },
    ], { cancelable: false });
  }, [ready, resolvingConflict, startupConflictDialogShown, startupConflictKind, startupConflictUid]);

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
      ) : ready && !startupConflictUid && !resolvingConflict ? (
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
