// components/KitFilterModal.tsx
import { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { IconChevronDown, IconChevronUp, IconSquare, IconSquareCheck } from '@tabler/icons-react-native';
import ClearableInput from './ClearableInput';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../lib/i18n';
import { useTheme, lightColors, radius, spacing, touch } from '../lib/theme';
import { useUiPrefs, type ListFontSize } from '../lib/uiPrefs';
import SwipeDownHeader from './SwipeDownHeader';
import SwipeDownScrollView from './SwipeDownScrollView';
import { useModalLock } from '../lib/modalLock';

export interface KitFilter {
  makers: string[];
  series: string[];
  categories: string[];
  scales: string[];
  search: string;
}

interface Props {
  visible: boolean;
  // 絞り込み候補(登録済みキットの maker/series/category/scale 組)
  options: { maker: string; series: string | null; category: string | null; scale: string | null }[];
  initial: KitFilter;
  onApply: (f: KitFilter) => void;
  onClose: () => void;
}

export default function KitFilterModal({ visible, options, initial, onApply, onClose }: Props) {
  useModalLock(visible);
  const { colors } = useTheme();
  const { listFontSize } = useUiPrefs();
  const styles = useMemo(() => makeStyles(colors, listFontSize), [colors, listFontSize]);
  const [makers, setMakers] = useState<string[]>(initial.makers);
  const [series, setSeries] = useState<string[]>(initial.series);
  const [categories, setCategories] = useState<string[]>(initial.categories);
  const [scales, setScales] = useState<string[]>(initial.scales);
  const [search, setSearch] = useState(initial.search);
  const [makerOpen, setMakerOpen] = useState(false);
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [scaleOpen, setScaleOpen] = useState(false);

  // 開くたびに適用済み条件(initial)へ同期。キャンセルで閉じた後に開き直すと
  // 破棄した変更ではなく最後に適用した状態が復活する。
  useEffect(() => {
    if (!visible) return;
    setMakers(initial.makers); setSeries(initial.series);
    setCategories(initial.categories); setScales(initial.scales); setSearch(initial.search);
  }, [visible]);

  const makerOptions = useMemo(
    () => Array.from(new Set(options.map((o) => o.maker).filter(Boolean))).sort(),
    [options]
  );
  const seriesOptions = useMemo(
    () => Array.from(new Set(options.map((o) => o.series).filter((s): s is string => !!s))).sort(),
    [options]
  );
  const categoryOptions = useMemo(
    () => Array.from(new Set(options.map((o) => o.category).filter((c): c is string => !!c))).sort(),
    [options]
  );
  const scaleOptions = useMemo(
    () => Array.from(new Set(options.map((o) => o.scale).filter((s): s is string => !!s))).sort(),
    [options]
  );

  const toggle = (arr: string[], v: string, set: (x: string[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const clear = () => { setMakers([]); setSeries([]); setCategories([]); setScales([]); setSearch(''); };

  const checkRow = (key: string, label: string, checked: boolean, onPress: () => void) => (
    <TouchableOpacity key={key} style={styles.checkRow} onPress={onPress}>
      {checked
        ? <IconSquareCheck size={20} color={colors.primary} style={styles.checkIcon} />
        : <IconSquare size={20} color={colors.textPlaceholder} style={styles.checkIcon} />}
      <Text style={styles.checkLabel}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <SwipeDownHeader onClose={onClose}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerSide} onPress={onClose}>
              <Text style={[styles.headerBtn, { textAlign: 'left' }]}>{t('cancel')}</Text>
            </TouchableOpacity>
            <Text style={styles.title}>{t('filter')}</Text>
            <TouchableOpacity style={styles.headerSide} onPress={clear}>
              <Text style={[styles.headerBtn, { textAlign: 'right' }]}>{t('clear')}</Text>
            </TouchableOpacity>
          </View>
        </SwipeDownHeader>

        <SwipeDownScrollView onClose={onClose} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} alwaysBounceVertical>
          {/* キット名検索 */}
          <Text style={styles.sectionTitle}>{t('name')}</Text>
          <ClearableInput
            style={styles.input}
            placeholder={t('searchPlaceholder')}
            value={search}
            onChangeText={setSearch}
          />

          {/* メーカー複数選択 */}
          <TouchableOpacity style={styles.dropdown} onPress={() => setMakerOpen((o) => !o)}>
            <Text style={styles.dropdownLabel}>
              {t('maker')}{makers.length ? ` (${makers.length})` : ''}
            </Text>
            {makerOpen
              ? <IconChevronUp size={16} color={colors.textFaint} />
              : <IconChevronDown size={16} color={colors.textFaint} />}
          </TouchableOpacity>
          {makerOpen && (
            <View style={styles.checkList}>
              {makerOptions.length === 0
                ? <Text style={styles.emptyOpt}>{t('noResults')}</Text>
                : makerOptions.map((m) => checkRow(m, m, makers.includes(m), () => toggle(makers, m, setMakers)))}
            </View>
          )}

          {/* シリーズ複数選択 */}
          <TouchableOpacity style={styles.dropdown} onPress={() => setSeriesOpen((o) => !o)}>
            <Text style={styles.dropdownLabel}>
              {t('series')}{series.length ? ` (${series.length})` : ''}
            </Text>
            {seriesOpen
              ? <IconChevronUp size={16} color={colors.textFaint} />
              : <IconChevronDown size={16} color={colors.textFaint} />}
          </TouchableOpacity>
          {seriesOpen && (
            <View style={styles.checkList}>
              {seriesOptions.length === 0
                ? <Text style={styles.emptyOpt}>{t('noResults')}</Text>
                : seriesOptions.map((s) => checkRow(s, s, series.includes(s), () => toggle(series, s, setSeries)))}
            </View>
          )}

          {/* 種別複数選択 */}
          <TouchableOpacity style={styles.dropdown} onPress={() => setCategoryOpen((o) => !o)}>
            <Text style={styles.dropdownLabel}>
              {t('category')}{categories.length ? ` (${categories.length})` : ''}
            </Text>
            {categoryOpen
              ? <IconChevronUp size={16} color={colors.textFaint} />
              : <IconChevronDown size={16} color={colors.textFaint} />}
          </TouchableOpacity>
          {categoryOpen && (
            <View style={styles.checkList}>
              {categoryOptions.length === 0
                ? <Text style={styles.emptyOpt}>{t('noResults')}</Text>
                : categoryOptions.map((c) => checkRow(c, c, categories.includes(c), () => toggle(categories, c, setCategories)))}
            </View>
          )}

          {/* スケール複数選択 */}
          <TouchableOpacity style={styles.dropdown} onPress={() => setScaleOpen((o) => !o)}>
            <Text style={styles.dropdownLabel}>
              {t('scale')}{scales.length ? ` (${scales.length})` : ''}
            </Text>
            {scaleOpen
              ? <IconChevronUp size={16} color={colors.textFaint} />
              : <IconChevronDown size={16} color={colors.textFaint} />}
          </TouchableOpacity>
          {scaleOpen && (
            <View style={styles.checkList}>
              {scaleOptions.length === 0
                ? <Text style={styles.emptyOpt}>{t('noResults')}</Text>
                : scaleOptions.map((s) => checkRow(s, s, scales.includes(s), () => toggle(scales, s, setScales)))}
            </View>
          )}
        </SwipeDownScrollView>

        <TouchableOpacity
          style={styles.applyBtn}
          onPress={() => onApply({ makers, series, categories, scales, search: search.trim() })}
        >
          <Text style={styles.applyText}>{t('apply')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const FILTER_TEXT_SIZE: Record<ListFontSize, { dropdownLabel: number; checkLabel: number }> = {
  small: { dropdownLabel: 14, checkLabel: 13 },
  medium: { dropdownLabel: 16, checkLabel: 15 },
  large: { dropdownLabel: 18, checkLabel: 17 },
};

const makeStyles = (colors: typeof lightColors, listFontSize: ListFontSize) => {
  const sizes = FILTER_TEXT_SIZE[listFontSize];
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    header: { flexDirection: 'row', alignItems: 'center', padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
    headerSide: { flex: 1 },
    headerBtn: { color: colors.primary, fontSize: 16 },
    title: { flex: 1, fontSize: 18, fontWeight: 'bold', textAlign: 'center', color: colors.text },
    sectionTitle: { fontSize: 13, color: colors.textFaint, marginTop: spacing.xl, marginHorizontal: spacing.xl, marginBottom: spacing.sm },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10, marginHorizontal: spacing.xl, color: colors.text },
    dropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.xl, marginTop: spacing.lg, borderTopWidth: 1, borderColor: colors.borderLight },
    dropdownLabel: { fontSize: sizes.dropdownLabel, color: colors.text },
    checkList: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
    checkRow: { flexDirection: 'row', alignItems: 'center', minHeight: touch.min },
    checkIcon: { marginRight: 10 },
    checkLabel: { fontSize: sizes.checkLabel, color: colors.text },
    emptyOpt: { color: colors.textPlaceholder, paddingVertical: spacing.md },
    applyBtn: { backgroundColor: colors.primary, padding: spacing.xl, alignItems: 'center' },
    applyText: { color: colors.onPrimary, fontSize: 16, fontWeight: 'bold' },
  });
};
