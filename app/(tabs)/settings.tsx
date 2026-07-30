// app/(tabs)/settings.tsx
import { useCallback, useMemo, useState } from 'react';
import { View, Text, Switch, TouchableOpacity, ScrollView, StyleSheet, Alert, Platform, Linking } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useFocusEffect, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isAnalyticsEnabled, logEvent, setAnalyticsEnabled, useScreenView } from '../../lib/analytics';
import { getDB, getSetting, resetCatalogToMaster, setSetting } from '../../lib/db';
import { notifyBoxesChanged, setActiveBox } from '../../lib/activeBox';
import { notifyKitBoxesChanged, setActiveKitBox } from '../../lib/activeKitBox';
import { deleteKitPhoto } from '../../lib/kitPhoto';
import { t, setLocale, getLocale } from '../../lib/i18n';
import { useTheme, setThemeMode, ThemeMode, radius, spacing, lightColors } from '../../lib/theme';
import { useUiPrefs, setFabSide, setListFontSize } from '../../lib/uiPrefs';
import {
  ensureSubscriptionIdentity,
  getCurrentAuthUser,
  isAppleDeviceRequiredForDeletion,
  isAccountLinkConflict,
  linkAppleAccount,
  linkGoogleAccount,
  signInWithApple,
  signInWithGoogle,
  signOutUser,
  useAuthUser,
} from '../../lib/auth';
import { deleteCurrentAccount } from '../../lib/accountDeletion';
import { fetchBackupSnapshot, isCloudBackupReady, markCloudBackupReady, pushBackupToFirestore, restoreFromSnapshot, runRestoreDecision } from '../../lib/cloudBackup';
import { presentPaywall, restorePurchases, useEntitlements } from '../../lib/subscription';

const THEME_OPTIONS: { value: ThemeMode; labelKey: string }[] = [
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
  { value: 'system', labelKey: 'themeSystem' },
];

export default function SettingsScreen() {
  const [isJa, setIsJa] = useState(getLocale() === 'ja');
  const { colors, mode, isDark } = useTheme();
  const { fabSide, listFontSize } = useUiPrefs();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [analyticsOn, setAnalyticsOn] = useState(isAnalyticsEnabled());
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const authUser = useAuthUser();
  const { hasBackup, hasPhotoBackup } = useEntitlements();
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const busy = accountBusy || purchaseBusy;

  useScreenView('Settings');

  const loadLastBackupAt = useCallback(async () => {
    setLastBackupAt(await getSetting('last_backup_at'));
  }, []);

  useFocusEffect(useCallback(() => {
    loadLastBackupAt();
  }, [loadLastBackupAt]));

  const toggleLang = (val: boolean) => {
    setIsJa(val);
    setLocale(val ? 'ja' : 'en');
  };

  const toggleAnalytics = async (val: boolean) => {
    setAnalyticsOn(val);
    await setAnalyticsEnabled(val);
  };

  const confirmReset = (title: string, onConfirm: () => Promise<void>) => {
    Alert.alert(title, t('resetConfirmMessage'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('reset'), style: 'destructive', onPress: onConfirm },
    ]);
  };

  const resetOwned = () => confirmReset(t('resetOwned'), async () => {
    const db = getDB();
    await db.runAsync('DELETE FROM inventory');
    await db.runAsync('DELETE FROM boxes');
    const res = await db.runAsync('INSERT INTO boxes (name) VALUES (?)', ['Box']);
    const boxId = Number(res.lastInsertRowId);
    await setSetting('default_box_id', String(boxId));
    setActiveBox(boxId);
    notifyBoxesChanged();
    logEvent('reset_data', { target: 'owned' });
    router.navigate({ pathname: '/owned', params: { boxId: String(boxId), boxName: 'Box' } });
  });

  const resetKits = () => confirmReset(t('resetKits'), async () => {
    const db = getDB();
    const photos = await db.getAllAsync<{ uri: string }>('SELECT uri FROM kit_photos');
    let boxId = 0;
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM kit_color_paints');
      await db.runAsync('DELETE FROM kit_colors');
      await db.runAsync('DELETE FROM kit_photos');
      await db.runAsync('DELETE FROM kit_lists');
      await db.runAsync('DELETE FROM kits');
      await db.runAsync('DELETE FROM kit_boxes');
      const res = await db.runAsync('INSERT INTO kit_boxes (name) VALUES (?)', ['Box']);
      boxId = Number(res.lastInsertRowId);
      await db.runAsync(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ['default_kit_box_id', String(boxId)]
      );
    });
    for (const { uri } of photos) await deleteKitPhoto(uri);
    notifyKitBoxesChanged();
    setActiveKitBox(boxId);
    logEvent('reset_data', { target: 'kits' });
    router.navigate({ pathname: '/kits', params: { boxId: String(boxId), boxName: 'Box' } });
  });

  const resetFavorites = () => confirmReset(t('resetFavorites'), async () => {
    await getDB().runAsync("DELETE FROM lists WHERE type = 'favorites'");
    logEvent('reset_data', { target: 'favorites' });
  });

  const resetWishlist = () => confirmReset(t('resetWishlist'), async () => {
    await getDB().runAsync("DELETE FROM lists WHERE type = 'wishlist'");
    logEvent('reset_data', { target: 'wishlist' });
  });

  const resetCatalog = () => confirmReset(t('resetCatalog'), async () => {
    await resetCatalogToMaster();
    logEvent('reset_data', { target: 'catalog' });
  });

  const resetKitWishlist = () => confirmReset(t('resetKitWishlist'), async () => {
    await getDB().runAsync('DELETE FROM kit_lists');
    logEvent('reset_data', { target: 'kit_wishlist' });
  });

  // クラウド復元は端末のボックス/キットボックスを丸ごと入れ替えるため、他画面が
  // 参照しているリアクティブなボックス一覧・選択中ボックスを必ず更新し直す。
  const refreshAfterRestore = () => {
    setActiveBox('all');
    setActiveKitBox('all');
    notifyBoxesChanged();
    notifyKitBoxesChanged();
  };

  const restoreCloudBackup = async (expectedUid: string) => {
    const snapshot = await fetchBackupSnapshot(expectedUid);
    if (!snapshot) return;
    await restoreFromSnapshot(snapshot, expectedUid);
    await markCloudBackupReady(expectedUid);
    refreshAfterRestore();
  };

  const showConflictAlert = (expectedUid: string) => {
    Alert.alert(t('cloudRestoreConflictTitle'), t('cloudRestoreConflictMessage'), [
      {
        text: t('cloudRestoreFromCloud'),
        style: 'destructive',
        onPress: () => {
          setAccountBusy(true);
          restoreCloudBackup(expectedUid)
            .catch((e) => {
              console.error('restoreCloudBackup: failed', e);
              Alert.alert(t('error'), t('cloudBackupError'));
            })
            .finally(() => setAccountBusy(false));
        },
      },
      {
        text: t('cloudKeepDeviceData'),
        style: 'cancel',
        onPress: () => {
          setAccountBusy(true);
          markCloudBackupReady(expectedUid)
            .then(() => pushBackupToFirestore())
            .then(loadLastBackupAt)
            .catch((e) => {
              console.error('showConflictAlert: failed to keep device data', e);
              Alert.alert(t('error'), t('cloudBackupError'));
            })
            .finally(() => setAccountBusy(false));
        },
      },
    ]);
  };

  const handleSignIn = async (provider: 'Apple' | 'Google') => {
    if (busy) return;
    setAccountBusy(true);
    try {
      await (provider === 'Apple' ? signInWithApple() : signInWithGoogle());
      const expectedUid = getCurrentAuthUser()?.uid;
      if (!expectedUid) throw new Error('Firebase sign-in did not establish a user.');
      const result = await runRestoreDecision();
      if (result === 'conflict') showConflictAlert(expectedUid);
      refreshAfterRestore();
      await loadLastBackupAt();
    } catch (e) {
      console.error(`handle${provider}SignIn: failed`, e);
      Alert.alert(t('error'), t('cloudBackupError'));
    } finally {
      setAccountBusy(false);
    }
  };

  const handleLinkAccount = async (provider: 'Apple' | 'Google') => {
    if (busy) return;
    setAccountBusy(true);
    try {
      await (provider === 'Apple' ? linkAppleAccount() : linkGoogleAccount());
    } catch (e) {
      console.error(`handleLink${provider}Account: failed`, e);
      Alert.alert(
        t('error'),
        isAccountLinkConflict(e)
          ? isJa
            ? 'この認証は別のColorackアカウントで使用されています。バックアップの上書きを防ぐため、自動統合は行いません。'
            : 'This sign-in is already used by another Colorack account. Automatic merging was stopped to protect both backups.'
          : t('cloudBackupError')
      );
    } finally {
      setAccountBusy(false);
    }
  };

  const handleBackupNow = async () => {
    if (busy) return;
    setAccountBusy(true);
    try {
      const { uid } = await ensureSubscriptionIdentity();
      if (!await isCloudBackupReady(uid)) {
        const result = await runRestoreDecision();
        if (result === 'conflict') {
          showConflictAlert(uid);
          return;
        }
      }
      await pushBackupToFirestore();
      await loadLastBackupAt();
    } catch (e) {
      console.error('handleBackupNow: failed', e);
      Alert.alert(t('error'), t('cloudBackupError'));
    } finally {
      setAccountBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (busy) return;
    setAccountBusy(true);
    try {
      await signOutUser();
    } catch (e) {
      console.error('handleSignOut: failed', e);
      Alert.alert(t('error'), t('cloudBackupError'));
    } finally {
      setAccountBusy(false);
    }
  };

  const handleViewPlans = async () => {
    if (busy) return;
    setPurchaseBusy(true);
    try {
      if (!authUser) {
        Alert.alert(
          t('account'),
          isJa
            ? '先にAppleまたはGoogleでログインしてください。'
            : 'Sign in with Apple or Google first.'
        );
        return;
      }
      const { uid } = await ensureSubscriptionIdentity();
      await presentPaywall(uid);
      const result = await runRestoreDecision();
      if (result === 'conflict') showConflictAlert(uid);
      refreshAfterRestore();
      await loadLastBackupAt();
    } catch (e) {
      console.error('handleViewPlans: failed', e);
      Alert.alert(t('error'), t('purchaseError'));
    } finally {
      setPurchaseBusy(false);
    }
  };

  const handleRestorePurchases = async () => {
    if (busy) return;
    setPurchaseBusy(true);
    try {
      if (!authUser) {
        Alert.alert(
          t('account'),
          isJa
            ? '先にAppleまたはGoogleでログインしてください。'
            : 'Sign in with Apple or Google first.'
        );
        return;
      }
      const { uid } = await ensureSubscriptionIdentity();
      await restorePurchases(uid);
      const result = await runRestoreDecision();
      if (result === 'conflict') showConflictAlert(uid);
      refreshAfterRestore();
      await loadLastBackupAt();
    } catch (e) {
      console.error('handleRestorePurchases: failed', e);
      Alert.alert(t('error'), t('purchaseError'));
    } finally {
      setPurchaseBusy(false);
    }
  };

  const handleDeleteAccount = () => {
    if (busy || !authUser) return;
    Alert.alert(
      isJa ? 'アカウントを削除' : 'Delete account',
      isJa
        ? 'クラウドバックアップとキット写真を完全に削除します。この端末のローカルデータは残ります。サブスクリプションは自動解約されません。'
        : 'This permanently deletes your cloud backup and kit photos. Local data on this device remains. Your subscription is not canceled automatically.',
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: isJa ? 'アカウントを削除' : 'Delete account',
          style: 'destructive',
          onPress: async () => {
            setAccountBusy(true);
            try {
              await deleteCurrentAccount();
              setLastBackupAt(null);
              Alert.alert(
                isJa ? '削除しました' : 'Account deleted',
                isJa
                  ? 'クラウドデータとアカウントを削除しました。'
                  : 'Your cloud data and account were deleted.'
              );
            } catch (e) {
              console.error('handleDeleteAccount: failed', e);
              Alert.alert(
                t('error'),
                isAppleDeviceRequiredForDeletion(e)
                  ? isJa
                    ? 'Apple連携済みアカウントは、Appleトークンを安全に失効するためiOS端末から削除してください。'
                    : 'Delete an Apple-linked account from an iOS device so its Apple token can be revoked safely.'
                  : t('cloudBackupError')
              );
            } finally {
              setAccountBusy(false);
            }
          },
        },
      ]
    );
  };

  const openSubscriptionManagement = () => {
    const url = Platform.OS === 'ios'
      ? 'https://apps.apple.com/account/subscriptions'
      : 'https://play.google.com/store/account/subscriptions';
    Linking.openURL(url).catch((e) => console.error('openSubscriptionManagement: failed', e));
  };

  const signInButtons = !authUser ? (
    <>
      {Platform.OS === 'ios' ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={isDark
            ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
            : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={radius.sm}
          style={styles.appleSignInBtn}
          onPress={() => handleSignIn('Apple')}
        />
      ) : null}
      <TouchableOpacity style={[styles.accountBtn, busy && styles.accountBtnDisabled]} onPress={() => handleSignIn('Google')} disabled={busy}>
        <Text style={styles.accountBtnText}>{t('signInWithGoogle')}</Text>
      </TouchableOpacity>
    </>
  ) : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('account')}</Text>
        <Text style={styles.accountSubText}>
          {t('currentPlan')}: {hasPhotoBackup ? t('planStandard') : hasBackup ? t('planLight') : t('planFree')}
        </Text>
        {hasBackup ? (
          <>
            <Text style={styles.accountSubText}>{hasPhotoBackup ? t('cloudBackupPhotosIncluded') : t('cloudBackupPhotosNote')}</Text>
            {authUser ? (
              <>
                <Text style={styles.accountText}>{authUser.displayName ?? authUser.email ?? authUser.uid}</Text>
                {authUser.email ? <Text style={styles.accountSubText}>{authUser.email}</Text> : null}
                <Text style={styles.accountSubText}>{t('lastBackupAt')}: {lastBackupAt ?? t('lastBackupNever')}</Text>
                <TouchableOpacity style={[styles.accountBtn, busy && styles.accountBtnDisabled]} onPress={handleBackupNow} disabled={busy}>
                  <Text style={styles.accountBtnText}>{t('backupNow')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.resetBtn, busy && styles.accountBtnDisabled]} onPress={handleSignOut} disabled={busy}>
                  <Text style={styles.resetBtnText}>{t('signOut')}</Text>
                </TouchableOpacity>
              </>
            ) : signInButtons}
          </>
        ) : (
          <>
            <Text style={styles.accountSubText}>{t('backupRequiresSubscription')}</Text>
            {signInButtons}
            <TouchableOpacity style={[styles.accountBtn, busy && styles.accountBtnDisabled]} onPress={handleViewPlans} disabled={busy}>
              <Text style={styles.accountBtnText}>{t('viewPlans')}</Text>
            </TouchableOpacity>
            {authUser ? (
              <TouchableOpacity style={[styles.resetBtn, busy && styles.accountBtnDisabled]} onPress={handleSignOut} disabled={busy}>
                <Text style={styles.resetBtnText}>{t('signOut')}</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
        {authUser ? (
          <View style={styles.accountLinkBox}>
            <Text style={styles.accountText}>
              {isJa ? '機種変更用のログイン連携' : 'Sign-in methods for device transfer'}
            </Text>
            <Text style={styles.accountSubText}>
              Apple: {authUser.providerIds.includes('apple.com') ? '✓' : '—'}
            </Text>
            {!authUser.providerIds.includes('apple.com') && Platform.OS === 'ios' ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={isDark
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={radius.sm}
                style={styles.appleSignInBtn}
                onPress={() => handleLinkAccount('Apple')}
              />
            ) : null}
            <Text style={styles.accountSubText}>
              Google: {authUser.providerIds.includes('google.com') ? '✓' : '—'}
            </Text>
            {!authUser.providerIds.includes('google.com') ? (
              <TouchableOpacity style={[styles.accountBtn, busy && styles.accountBtnDisabled]} onPress={() => handleLinkAccount('Google')} disabled={busy}>
                <Text style={styles.accountBtnText}>
                  {isJa ? 'Googleアカウントを連携' : 'Link Google account'}
                </Text>
              </TouchableOpacity>
            ) : null}
            <Text style={styles.accountSubText}>
              {isJa
                ? 'AppleとGoogleの両方を連携すると、iOSとAndroidのどちらでも同じバックアップを利用できます。'
                : 'Link both Apple and Google to use the same backup on iOS and Android.'}
            </Text>
          </View>
        ) : null}
        <TouchableOpacity style={[styles.resetBtn, busy && styles.accountBtnDisabled]} onPress={handleRestorePurchases} disabled={busy}>
          <Text style={styles.resetBtnText}>{t('restorePurchases')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.resetBtn} onPress={openSubscriptionManagement}>
          <Text style={styles.resetBtnText}>
            {isJa ? 'サブスクリプションを管理' : 'Manage subscription'}
          </Text>
        </TouchableOpacity>
        {authUser ? (
          <TouchableOpacity style={[styles.resetBtn, busy && styles.accountBtnDisabled]} onPress={handleDeleteAccount} disabled={busy}>
            <Text style={styles.resetBtnText}>
              {isJa ? 'アカウントを削除' : 'Delete account'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('analytics')}</Text>
        <View style={styles.langRow}>
          <Text style={{ color: colors.text }}>{t('analyticsEnabled')}</Text>
          <Switch value={analyticsOn} onValueChange={toggleAnalytics} style={{ marginHorizontal: 8 }} />
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('language')}</Text>
        <View style={styles.langRow}>
          <Text style={{ color: colors.text }}>EN</Text>
          <Switch value={isJa} onValueChange={toggleLang} style={{ marginHorizontal: 8 }} accessibilityLabel={t('language')} />
          <Text style={{ color: colors.text }}>JA</Text>
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('theme')}</Text>
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.themeBtn, mode === opt.value && styles.themeBtnOn]}
              onPress={() => setThemeMode(opt.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === opt.value }}
            >
              <Text style={[styles.themeBtnText, mode === opt.value && styles.themeBtnTextOn]} numberOfLines={1}>{t(opt.labelKey)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('fabPosition')}</Text>
        <View style={styles.themeRow}>
          <TouchableOpacity style={[styles.themeBtn, fabSide === 'left' && styles.themeBtnOn]} onPress={() => setFabSide('left')} accessibilityRole="radio" accessibilityState={{ selected: fabSide === 'left' }}>
            <Text style={[styles.themeBtnText, fabSide === 'left' && styles.themeBtnTextOn]} numberOfLines={1}>{t('fabPositionLeft')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.themeBtn, fabSide === 'right' && styles.themeBtnOn]} onPress={() => setFabSide('right')} accessibilityRole="radio" accessibilityState={{ selected: fabSide === 'right' }}>
            <Text style={[styles.themeBtnText, fabSide === 'right' && styles.themeBtnTextOn]} numberOfLines={1}>{t('fabPositionRight')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('listFontSize')}</Text>
        <View style={styles.themeRow}>
          <TouchableOpacity style={[styles.themeBtn, listFontSize === 'small' && styles.themeBtnOn]} onPress={() => setListFontSize('small')}>
            <Text style={[styles.themeBtnText, listFontSize === 'small' && styles.themeBtnTextOn, { fontSize: 13 }]} numberOfLines={1}>{t('fontSizeSmall')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.themeBtn, listFontSize === 'medium' && styles.themeBtnOn]} onPress={() => setListFontSize('medium')}>
            <Text style={[styles.themeBtnText, listFontSize === 'medium' && styles.themeBtnTextOn, { fontSize: 15 }]} numberOfLines={1}>{t('fontSizeMedium')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.themeBtn, listFontSize === 'large' && styles.themeBtnOn]} onPress={() => setListFontSize('large')}>
            <Text style={[styles.themeBtnText, listFontSize === 'large' && styles.themeBtnTextOn, { fontSize: 17 }]} numberOfLines={1}>{t('fontSizeLarge')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('reset')}</Text>
        <TouchableOpacity style={styles.resetBtn} onPress={resetOwned}>
          <Text style={styles.resetBtnText}>{t('resetOwned')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.resetBtn} onPress={resetKits}>
          <Text style={styles.resetBtnText}>{t('resetKits')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.resetBtn} onPress={resetFavorites}>
          <Text style={styles.resetBtnText}>{t('resetFavorites')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.resetBtn} onPress={resetWishlist}>
          <Text style={styles.resetBtnText}>{t('resetWishlist')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.resetBtn} onPress={resetKitWishlist}>
          <Text style={styles.resetBtnText}>{t('resetKitWishlist')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.resetBtn} onPress={resetCatalog}>
          <Text style={styles.resetBtnText}>{t('resetCatalog')}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.xl },
  section: { marginBottom: spacing.xxl },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: spacing.md, color: colors.text },
  langRow: { flexDirection: 'row', alignItems: 'center' },
  themeRow: { flexDirection: 'row' },
  themeBtn: { flex: 1, padding: spacing.lg, borderRadius: radius.sm, backgroundColor: colors.chip, marginRight: spacing.md, alignItems: 'center' },
  themeBtnOn: { backgroundColor: colors.primary },
  themeBtnText: { color: colors.textSecondary },
  themeBtnTextOn: { color: colors.onPrimary, fontWeight: 'bold' },
  resetBtn: { backgroundColor: colors.dangerSoft, borderRadius: radius.sm, padding: spacing.lg, marginBottom: spacing.md },
  resetBtnText: { color: colors.dangerText, fontWeight: 'bold', textAlign: 'center' },
  accountText: { fontSize: 16, fontWeight: 'bold', color: colors.text, marginBottom: spacing.xs },
  accountSubText: { fontSize: 14, color: colors.textSecondary, marginBottom: spacing.md },
  accountLinkBox: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.lg },
  accountBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, padding: spacing.lg, marginBottom: spacing.md },
  appleSignInBtn: { width: '100%', height: 44, marginBottom: spacing.md },
  accountBtnDisabled: { backgroundColor: colors.primaryDisabled },
  accountBtnText: { color: colors.onPrimary, fontWeight: 'bold', textAlign: 'center' },
});
