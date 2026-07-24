// app/(tabs)/settings.tsx
import { useCallback, useMemo, useState } from 'react';
import { View, Text, Switch, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
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
import { signInWithGoogle, signOutUser, useAuthUser } from '../../lib/auth';
import { fetchBackupSnapshot, pushBackupToFirestore, restoreFromSnapshot, runRestoreDecision } from '../../lib/cloudBackup';
import { presentPaywall, restorePurchases, useEntitlements } from '../../lib/subscription';

const THEME_OPTIONS: { value: ThemeMode; labelKey: string }[] = [
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
  { value: 'system', labelKey: 'themeSystem' },
];

export default function SettingsScreen() {
  const [isJa, setIsJa] = useState(getLocale() === 'ja');
  const { colors, mode } = useTheme();
  const { fabSide, listFontSize } = useUiPrefs();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [analyticsOn, setAnalyticsOn] = useState(isAnalyticsEnabled());
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const authUser = useAuthUser();
  const { hasBackup, hasPhotoBackup } = useEntitlements();
  const [purchaseBusy, setPurchaseBusy] = useState(false);

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

  const restoreCloudBackup = async () => {
    const snapshot = await fetchBackupSnapshot();
    if (!snapshot) return;
    await restoreFromSnapshot(snapshot);
    refreshAfterRestore();
  };

  const showConflictAlert = () => {
    Alert.alert(t('cloudRestoreConflictTitle'), t('cloudRestoreConflictMessage'), [
      { text: t('cloudRestoreFromCloud'), style: 'destructive', onPress: () => { restoreCloudBackup().catch(console.error); } },
      { text: t('cloudKeepDeviceData'), style: 'cancel' },
    ]);
  };

  const handleGoogleSignIn = async () => {
    if (accountBusy) return;
    setAccountBusy(true);
    try {
      await signInWithGoogle();
      const result = await runRestoreDecision();
      if (result === 'conflict') showConflictAlert();
      refreshAfterRestore();
      await loadLastBackupAt();
    } catch (e) {
      console.error('handleGoogleSignIn: failed', e);
      Alert.alert(t('error'), t('cloudBackupError'));
    } finally {
      setAccountBusy(false);
    }
  };

  const handleBackupNow = async () => {
    if (accountBusy) return;
    setAccountBusy(true);
    try {
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
    if (accountBusy) return;
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
    if (purchaseBusy) return;
    setPurchaseBusy(true);
    try {
      await presentPaywall();
    } catch (e) {
      console.error('handleViewPlans: failed', e);
      Alert.alert(t('error'), t('purchaseError'));
    } finally {
      setPurchaseBusy(false);
    }
  };

  const handleRestorePurchases = async () => {
    if (purchaseBusy) return;
    setPurchaseBusy(true);
    try {
      await restorePurchases();
    } catch (e) {
      console.error('handleRestorePurchases: failed', e);
      Alert.alert(t('error'), t('purchaseError'));
    } finally {
      setPurchaseBusy(false);
    }
  };

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
                <TouchableOpacity style={[styles.accountBtn, accountBusy && styles.accountBtnDisabled]} onPress={handleBackupNow} disabled={accountBusy}>
                  <Text style={styles.accountBtnText}>{t('backupNow')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.resetBtn, accountBusy && styles.accountBtnDisabled]} onPress={handleSignOut} disabled={accountBusy}>
                  <Text style={styles.resetBtnText}>{t('signOut')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={[styles.accountBtn, accountBusy && styles.accountBtnDisabled]} onPress={handleGoogleSignIn} disabled={accountBusy}>
                <Text style={styles.accountBtnText}>{t('signInWithGoogle')}</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <>
            <Text style={styles.accountSubText}>{t('backupRequiresSubscription')}</Text>
            <TouchableOpacity style={[styles.accountBtn, purchaseBusy && styles.accountBtnDisabled]} onPress={handleViewPlans} disabled={purchaseBusy}>
              <Text style={styles.accountBtnText}>{t('viewPlans')}</Text>
            </TouchableOpacity>
            {authUser ? (
              <TouchableOpacity style={[styles.resetBtn, accountBusy && styles.accountBtnDisabled]} onPress={handleSignOut} disabled={accountBusy}>
                <Text style={styles.resetBtnText}>{t('signOut')}</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
        <TouchableOpacity style={[styles.resetBtn, purchaseBusy && styles.accountBtnDisabled]} onPress={handleRestorePurchases} disabled={purchaseBusy}>
          <Text style={styles.resetBtnText}>{t('restorePurchases')}</Text>
        </TouchableOpacity>
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
  accountBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, padding: spacing.lg, marginBottom: spacing.md },
  accountBtnDisabled: { backgroundColor: colors.primaryDisabled },
  accountBtnText: { color: colors.onPrimary, fontWeight: 'bold', textAlign: 'center' },
});
