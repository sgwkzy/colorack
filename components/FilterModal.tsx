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
import { paintTypeLabel } from '../lib/paintType';

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
  options: { brand: string; series: string; gloss: string | null; paint_type: string | null }[];
  initial: PaintFilter;
  onApply: (f: PaintFilter) => void;
  onClose: () => void;
}

export default function FilterModal({ visible, options, initial, onApply, onClose }: Props) {
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
                : seriesOptions.map((s) => checkRow(s, s, series.includes(s), () => toggle(series, s, setSeries)))}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  headerSide: { flex: 1 },
  headerBtn: { color: '#4a90d9', fontSize: 16 },
  title: { flex: 1, fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  sectionTitle: { fontSize: 13, color: '#888', marginTop: 16, marginHorizontal: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginHorizontal: 16 },
  dropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, marginTop: 12, borderTopWidth: 1, borderColor: '#eee' },
  dropdownLabel: { fontSize: 16 },
  dropdownArrow: { fontSize: 12, color: '#888' },
  checkList: { paddingHorizontal: 16, paddingBottom: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  checkBox: { fontSize: 18, color: '#bbb', marginRight: 10 },
  checkBoxOn: { color: '#4a90d9' },
  checkLabel: { fontSize: 15 },
  emptyOpt: { color: '#999', paddingVertical: 8 },
  applyBtn: { backgroundColor: '#4a90d9', padding: 16, alignItems: 'center' },
  applyText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
