// components/FilterModal.tsx
import { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import ClearableInput from './ClearableInput';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../lib/i18n';
import { brandLabel } from '../lib/brands';
import { glossLabel } from '../lib/gloss';
import { seriesLabel } from '../lib/paintLabel';
import { paintTypeLabel } from '../lib/paintType';
import { useTheme, lightColors, radius, spacing } from '../lib/theme';

export interface PaintFilter {
  brands: string[];
  series: string[];
  gloss: string[];
  types: string[];
  search: string;
}

interface Props {
  visible: boolean;
  // 絞り込み候補(所有塗料の brand/series/gloss/paint_type 組)
  options: { brand: string; series: string; series_en?: string | null; gloss: string | null; paint_type: string | null }[];
  initial: PaintFilter;
  onApply: (f: PaintFilter) => void;
  onClose: () => void;
}

export default function FilterModal({ visible, options, initial, onApply, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [brands, setBrands] = useState<string[]>(initial.brands);
  const [series, setSeries] = useState<string[]>(initial.series);
  const [gloss, setGloss] = useState<string[]>(initial.gloss);
  const [types, setTypes] = useState<string[]>(initial.types);
  const [search, setSearch] = useState(initial.search);
  const [brandOpen, setBrandOpen] = useState(false);
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [glossOpen, setGlossOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);

  // 開くたびに適用済み条件(initial)へ同期。キャンセルで閉じた後に開き直すと
  // 破棄した変更ではなく最後に適用した状態が復活する。
  useEffect(() => {
    if (!visible) return;
    setBrands(initial.brands); setSeries(initial.series);
    setGloss(initial.gloss); setTypes(initial.types); setSearch(initial.search);
  }, [visible]);

  const allBrands = useMemo(
    () => Array.from(new Set(options.map((o) => o.brand).filter(Boolean))).sort(),
    [options]
  );
  // 選択ブランドがあればそのシリーズのみ、無ければ全シリーズ
  const seriesOptions = useMemo(() => {
    const rel = options.filter((o) => brands.length === 0 || brands.includes(o.brand));
    return Array.from(new Set(rel.map((o) => o.series).filter(Boolean))).sort();
  }, [options, brands]);
  const seriesNames = useMemo(() => {
    const names = new Map<string, string | null | undefined>();
    options.forEach((o) => {
      if (o.series && !names.has(o.series)) names.set(o.series, o.series_en);
    });
    return names;
  }, [options]);
  const glossOptions = useMemo(
    () => Array.from(new Set(options.map((o) => o.gloss).filter((g): g is string => !!g))).sort(),
    [options]
  );
  const typeOptions = useMemo(
    () => Array.from(new Set(options.map((o) => o.paint_type).filter((p): p is string => !!p))).sort(),
    [options]
  );

  const toggle = (arr: string[], v: string, set: (x: string[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const clear = () => { setBrands([]); setSeries([]); setGloss([]); setTypes([]); setSearch(''); };

  const checkRow = (key: string, label: string, checked: boolean, onPress: () => void) => (
    <TouchableOpacity key={key} style={styles.checkRow} onPress={onPress}>
      <Text style={[styles.checkBox, checked && styles.checkBoxOn]}>{checked ? '☑' : '☐'}</Text>
      <Text style={styles.checkLabel}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerSide} onPress={onClose}>
            <Text style={[styles.headerBtn, { textAlign: 'left' }]}>{t('cancel')}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{t('filter')}</Text>
          <TouchableOpacity style={styles.headerSide} onPress={clear}>
            <Text style={[styles.headerBtn, { textAlign: 'right' }]}>{t('clear')}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }}>
          {/* 色名検索 */}
          <Text style={styles.sectionTitle}>{t('colorName')}</Text>
          <ClearableInput
            style={styles.input}
            placeholder={t('searchPlaceholder')}
            value={search}
            onChangeText={setSearch}
          />

          {/* ブランド複数選択 */}
          <TouchableOpacity style={styles.dropdown} onPress={() => setBrandOpen((o) => !o)}>
            <Text style={styles.dropdownLabel}>
              {t('brand')}{brands.length ? ` (${brands.length})` : ''}
            </Text>
            <Text style={styles.dropdownArrow}>{brandOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {brandOpen && (
            <View style={styles.checkList}>
              {allBrands.length === 0
                ? <Text style={styles.emptyOpt}>{t('noResults')}</Text>
                : allBrands.map((b) => checkRow(b, brandLabel(b), brands.includes(b), () => toggle(brands, b, setBrands)))}
            </View>
          )}

          {/* シリーズ複数選択 */}
          <TouchableOpacity style={styles.dropdown} onPress={() => setSeriesOpen((o) => !o)}>
            <Text style={styles.dropdownLabel}>
              {t('series')}{series.length ? ` (${series.length})` : ''}
            </Text>
            <Text style={styles.dropdownArrow}>{seriesOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {seriesOpen && (
            <View style={styles.checkList}>
              {seriesOptions.length === 0
                ? <Text style={styles.emptyOpt}>{t('noResults')}</Text>
                : seriesOptions.map((s) => checkRow(s, seriesLabel(s, seriesNames.get(s)), series.includes(s), () => toggle(series, s, setSeries)))}
            </View>
          )}

          {/* つや複数選択 */}
          <TouchableOpacity style={styles.dropdown} onPress={() => setGlossOpen((o) => !o)}>
            <Text style={styles.dropdownLabel}>
              {t('gloss')}{gloss.length ? ` (${gloss.length})` : ''}
            </Text>
            <Text style={styles.dropdownArrow}>{glossOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {glossOpen && (
            <View style={styles.checkList}>
              {glossOptions.length === 0
                ? <Text style={styles.emptyOpt}>{t('noResults')}</Text>
                : glossOptions.map((g) => checkRow(g, glossLabel(g), gloss.includes(g), () => toggle(gloss, g, setGloss)))}
            </View>
          )}

          {/* 塗料種別複数選択 */}
          <TouchableOpacity style={styles.dropdown} onPress={() => setTypeOpen((o) => !o)}>
            <Text style={styles.dropdownLabel}>
              {t('paintType')}{types.length ? ` (${types.length})` : ''}
            </Text>
            <Text style={styles.dropdownArrow}>{typeOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {typeOpen && (
            <View style={styles.checkList}>
              {typeOptions.length === 0
                ? <Text style={styles.emptyOpt}>{t('noResults')}</Text>
                : typeOptions.map((p) => checkRow(p, paintTypeLabel(p), types.includes(p), () => toggle(types, p, setTypes)))}
            </View>
          )}
        </ScrollView>

        <TouchableOpacity
          style={styles.applyBtn}
          onPress={() => {
            // 選択ブランド外のシリーズ選択は落とす
            const validSeries = series.filter((s) => seriesOptions.includes(s));
            onApply({ brands, series: validSeries, gloss, types, search: search.trim() });
          }}
        >
          <Text style={styles.applyText}>{t('apply')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  headerSide: { flex: 1 },
  headerBtn: { color: colors.primary, fontSize: 16 },
  title: { flex: 1, fontSize: 18, fontWeight: 'bold', textAlign: 'center', color: colors.text },
  sectionTitle: { fontSize: 13, color: colors.textFaint, marginTop: spacing.xl, marginHorizontal: spacing.xl, marginBottom: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10, marginHorizontal: spacing.xl, color: colors.text },
  dropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.xl, marginTop: spacing.lg, borderTopWidth: 1, borderColor: colors.borderLight },
  dropdownLabel: { fontSize: 16, color: colors.text },
  dropdownArrow: { fontSize: 12, color: colors.textFaint },
  checkList: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  checkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  checkBox: { fontSize: 18, color: '#bbb', marginRight: 10 },
  checkBoxOn: { color: colors.primary },
  checkLabel: { fontSize: 15, color: colors.text },
  emptyOpt: { color: colors.textPlaceholder, paddingVertical: spacing.md },
  applyBtn: { backgroundColor: colors.primary, padding: spacing.xl, alignItems: 'center' },
  applyText: { color: colors.onPrimary, fontSize: 16, fontWeight: 'bold' },
});
