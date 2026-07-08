// app/(tabs)/settings.tsx
import { useCallback, useMemo, useState } from 'react';
import { View, Text, Switch, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react-native';
import { useFocusEffect } from 'expo-router';
import { getDB, getDefaultBoxId, resetCatalogToMaster, setSetting } from '../../lib/db';
import { t, setLocale, getLocale } from '../../lib/i18n';
import { useTheme, setThemeMode, ThemeMode, radius, spacing, lightColors } from '../../lib/theme';
import { useUiPrefs, setFabSide, setListFontSize } from '../../lib/uiPrefs';

interface Box { id: number; name: string; }

const THEME_OPTIONS: { value: ThemeMode; labelKey: string }[] = [
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
  { value: 'system', labelKey: 'themeSystem' },
];

export default function SettingsScreen() {
  const [isJa, setIsJa] = useState(getLocale() === 'ja');
  const { colors, mode } = useTheme();
  const { fabSide, listFontSize } = useUiPrefs();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [defaultBoxId, setDefaultBoxId] = useState<number | null>(null);
  const [boxPickerOpen, setBoxPickerOpen] = useState(false);

  const loadBoxes = useCallback(async () => {
    const db = getDB();
    setBoxes(await db.getAllAsync<Box>('SELECT id, name FROM boxes ORDER BY id'));
    setDefaultBoxId(await getDefaultBoxId());
  }, []);

  useFocusEffect(useCallback(() => { loadBoxes(); }, [loadBoxes]));

  const chooseDefaultBox = async (boxId: number) => {
    setDefaultBoxId(boxId);
    setBoxPickerOpen(false);
    await setSetting('default_box_id', String(boxId));
  };

  const defaultBoxName = boxes.find((b) => b.id === defaultBoxId)?.name ?? '';

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
    await setSetting('default_box_id', String(res.lastInsertRowId));
    await loadBoxes();
  });

  const resetFavorites = () => confirmReset(t('resetFavorites'), async () => {
    await getDB().runAsync("DELETE FROM lists WHERE type = 'favorites'");
  });

  const resetWishlist = () => confirmReset(t('resetWishlist'), async () => {
    await getDB().runAsync("DELETE FROM lists WHERE type = 'wishlist'");
  });

  const resetCatalog = () => confirmReset(t('resetCatalog'), resetCatalogToMaster);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('language')}</Text>
        <View style={styles.langRow}>
          <Text style={{ color: colors.text }}>EN</Text>
          <Switch value={isJa} onValueChange={toggleLang} style={{ marginHorizontal: 8 }} />
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
            >
              <Text style={[styles.themeBtnText, mode === opt.value && styles.themeBtnTextOn]} numberOfLines={1}>{t(opt.labelKey)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('fabPosition')}</Text>
        <View style={styles.themeRow}>
          <TouchableOpacity style={[styles.themeBtn, fabSide === 'left' && styles.themeBtnOn]} onPress={() => setFabSide('left')}>
            <Text style={[styles.themeBtnText, fabSide === 'left' && styles.themeBtnTextOn]} numberOfLines={1}>{t('fabPositionLeft')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.themeBtn, fabSide === 'right' && styles.themeBtnOn]} onPress={() => setFabSide('right')}>
            <Text style={[styles.themeBtnText, fabSide === 'right' && styles.themeBtnTextOn]} numberOfLines={1}>{t('fabPositionRight')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.themeBtn, fabSide === 'bottom' && styles.themeBtnOn]} onPress={() => setFabSide('bottom')}>
            <Text style={[styles.themeBtnText, fabSide === 'bottom' && styles.themeBtnTextOn]} numberOfLines={1}>{t('fabPositionBottom')}</Text>
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
        <Text style={styles.sectionTitle}>{t('defaultBox')}</Text>
        <TouchableOpacity style={styles.dropdown} onPress={() => setBoxPickerOpen((o) => !o)}>
          <Text style={styles.dropdownLabel}>{defaultBoxName}</Text>
          {boxPickerOpen
            ? <IconChevronUp size={16} color={colors.textFaint} />
            : <IconChevronDown size={16} color={colors.textFaint} />}
        </TouchableOpacity>
        {boxPickerOpen && (
          <ScrollView style={styles.dropdownList} nestedScrollEnabled>
            {boxes.map((b) => (
              <TouchableOpacity key={b.id} style={styles.dropdownItem} onPress={() => chooseDefaultBox(b.id)}>
                <Text style={[styles.dropdownItemText, defaultBoxId === b.id && styles.dropdownItemTextOn]}>{b.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
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
  dropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.lg },
  dropdownLabel: { fontSize: 16, color: colors.text },
  dropdownList: { borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.sm, borderBottomRightRadius: radius.sm, maxHeight: 220 },
  dropdownItem: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderLight },
  dropdownItemText: { fontSize: 15, color: colors.text },
  dropdownItemTextOn: { color: colors.primary, fontWeight: 'bold' },
});
