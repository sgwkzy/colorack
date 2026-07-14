// app/(tabs)/settings.tsx
import { useMemo, useState } from 'react';
import { View, Text, Switch, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { getDB, resetCatalogToMaster, setSetting } from '../../lib/db';
import { notifyBoxesChanged, setActiveBox } from '../../lib/activeBox';
import { router } from 'expo-router';
import { t, setLocale, getLocale } from '../../lib/i18n';
import { useTheme, setThemeMode, ThemeMode, radius, spacing, lightColors } from '../../lib/theme';
import { useUiPrefs, setActionOrder, setListFontSize } from '../../lib/uiPrefs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const THEME_OPTIONS: { value: ThemeMode; labelKey: string }[] = [
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
  { value: 'system', labelKey: 'themeSystem' },
];

export default function SettingsScreen() {
  const [isJa, setIsJa] = useState(getLocale() === 'ja');
  const { colors, mode } = useTheme();
  const { actionOrder, listFontSize } = useUiPrefs();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toggleLang = (val: boolean) => {
    setIsJa(val);
    setLocale(val ? 'ja' : 'en');
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
    router.navigate({ pathname: '/owned', params: { boxId: String(boxId), boxName: 'Box' } });
  });

  const resetFavorites = () => confirmReset(t('resetFavorites'), async () => {
    await getDB().runAsync("DELETE FROM lists WHERE type = 'favorites'");
  });

  const resetWishlist = () => confirmReset(t('resetWishlist'), async () => {
    await getDB().runAsync("DELETE FROM lists WHERE type = 'wishlist'");
  });

  const resetCatalog = () => confirmReset(t('resetCatalog'), resetCatalogToMaster);

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
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
        <Text style={styles.sectionTitle}>{t('actionOrder')}</Text>
        <View style={styles.themeRow}>
          <TouchableOpacity style={[styles.themeBtn, actionOrder === 'normal' && styles.themeBtnOn]} onPress={() => setActionOrder('normal')}>
            <Text style={[styles.themeBtnText, actionOrder === 'normal' && styles.themeBtnTextOn]} numberOfLines={1}>{t('actionOrderNormal')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.themeBtn, actionOrder === 'reverse' && styles.themeBtnOn]} onPress={() => setActionOrder('reverse')}>
            <Text style={[styles.themeBtnText, actionOrder === 'reverse' && styles.themeBtnTextOn]} numberOfLines={1}>{t('actionOrderReverse')}</Text>
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
        <TouchableOpacity style={styles.resetBtn} onPress={resetFavorites}>
          <Text style={styles.resetBtnText}>{t('resetFavorites')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.resetBtn} onPress={resetWishlist}>
          <Text style={styles.resetBtnText}>{t('resetWishlist')}</Text>
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
  resetBtnText: { color: colors.danger, fontWeight: 'bold', textAlign: 'center' },
});
