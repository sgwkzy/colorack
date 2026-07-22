// components/AddPaint/ColorMatcher.tsx
import { useEffect, useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { IconAdjustmentsHorizontal, IconCamera, IconPlus } from '@tabler/icons-react-native';
import ClearableInput from '../ClearableInput';
import ColorCameraPicker from '../ColorCameraPicker';
import { getDB, getOwnedCountMap } from '../../lib/db';
import { rgb_to_lab, delta_e, hex_to_rgb } from '../../lib/color';
import { t } from '../../lib/i18n';
import { useTheme, lightColors, radius, spacing, touch } from '../../lib/theme';
import PaintRow from '../PaintRow';
import { isValidHex } from '../PaintFormFields';
import { swipeDownCloseProps } from '../SwipeDownScrollView';
import FilterModal, { PaintFilter } from '../FilterModal';

interface Paint {
  id: number;
  name_ja: string;
  name_en: string | null;
  code: string;
  brand: string;
  hex: string;
  gloss: string | null;
  paint_type: string | null;
  r: number;
  g: number;
  b: number;
  l: number;
  a_star: number;
  b_star: number;
}

interface Props {
  onSelect: (paint: Paint) => void;
  onSelectView: (paint: Paint) => void;
  // 一覧を最上部からさらに引っ張って離した時に親モーダルを閉じる
  onRequestClose?: () => void;
  // 指定時、塗料種別フィルタをこの1種類に固定し、種別チップUIを非表示にする
  lockedPaintType?: string;
}

const EMPTY_FILTER: PaintFilter = { brands: [], series: [], gloss: [], types: [], search: '' };
type FilterOption = { brand: string; series: string; series_en: string | null; gloss: string | null; paint_type: string | null };

export default function ColorMatcher({ onSelect, onSelectView, onRequestClose, lockedPaintType }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const closeProps = onRequestClose ? swipeDownCloseProps(onRequestClose) : undefined;
  const [hex, setHex] = useState('');
  const [results, setResults] = useState<(Paint & { de: number })[]>([]);
  const [ownedCounts, setOwnedCounts] = useState<Map<number, number>>(new Map());
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const [filter, setFilter] = useState<PaintFilter>({ ...EMPTY_FILTER, types: lockedPaintType ? [lockedPaintType] : [] });
  const [filterOptions, setFilterOptions] = useState<FilterOption[]>([]);
  const [showFilter, setShowFilter] = useState(false);
  const canMatchHex = isValidHex(hex);

  useEffect(() => {
    getDB().getAllAsync<FilterOption>('SELECT DISTINCT brand, series, series_en, gloss, paint_type FROM catalog_paints')
      .then(setFilterOptions);
  }, []);

  const search = async (ri: number, gi: number, bi: number, nextFilter: PaintFilter = filter) => {
    const targetLab = rgb_to_lab(ri, gi, bi);
    const db = getDB();
    const where = ['l IS NOT NULL'];
    const args: string[] = [];
    const addIn = (column: string, values: string[]) => {
      if (!values.length) return;
      where.push(`${column} IN (${values.map(() => '?').join(',')})`);
      args.push(...values);
    };
    addIn('brand', nextFilter.brands);
    addIn('series', nextFilter.series);
    addIn('gloss', nextFilter.gloss);
    addIn('paint_type', nextFilter.types);
    const [all, ownedMap] = await Promise.all([
      db.getAllAsync<Paint>(
        'SELECT id, name_ja, name_en, code, brand, hex, gloss, paint_type, r, g, b, l, a_star, b_star FROM catalog_paints WHERE ' + where.join(' AND '),
        args
      ),
      getOwnedCountMap(),
    ]);
    const scored = all
      .map((p) => ({ ...p, de: delta_e(targetLab, { L: p.l, a: p.a_star, b: p.b_star }) }))
      .sort((a, b) => a.de - b.de)
      .slice(0, 10);
    setResults(scored);
    setOwnedCounts(ownedMap);
  };

  const matchHex = () => {
    const rgb = hex_to_rgb(hex);
    if (!rgb) return;
    search(rgb.r, rgb.g, rgb.b);
  };

  const filterCount = filter.brands.length + filter.series.length + filter.gloss.length + filter.types.length;
  const filterActive = filterCount > 0;

  return (
    <View style={styles.container}>
      <View style={styles.controls}>
        <Text style={styles.inputLabel}>{t('enterHex')}</Text>
        <View style={styles.inputRow}>
          <View style={[styles.targetSwatch, { backgroundColor: canMatchHex ? hex : colors.chip }]} />
          <ClearableInput
            style={styles.hexInput}
            placeholder="#1a2b3c"
            autoCapitalize="none"
            value={hex}
            onChangeText={setHex}
            maxLength={7}
          />
          <TouchableOpacity
            style={styles.cameraBtn}
            onPress={() => setColorPickerVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={t('pickColorWithCamera')}
          >
            <IconCamera color={colors.primary} size={20} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.matchButton, !canMatchHex && styles.matchButtonDisabled]}
            onPress={matchHex}
            disabled={!canMatchHex}
            accessibilityRole="button"
          >
            <Text style={styles.matchButtonText} numberOfLines={1}>{t('colorMatch')}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.filterRow}>
          {results.length > 0 ? <View style={styles.resultSummary}>
            <Text style={styles.resultTitle}>{t('colorMatch')}</Text>
            <Text style={styles.resultCount}>{results.length}</Text>
          </View> : <View />}
          <TouchableOpacity
            style={[styles.filterButton, filterActive && styles.filterButtonActive]}
            onPress={() => setShowFilter(true)}
            accessibilityRole="button"
            accessibilityState={{ selected: filterActive }}
          >
            <IconAdjustmentsHorizontal size={18} color={filterActive ? colors.primaryText : colors.textMuted} />
            <Text style={[styles.filterText, filterActive && styles.filterTextActive]} numberOfLines={1}>
              {t('filter')}{filterActive ? ` (${filterCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={results}
        {...closeProps}
        contentContainerStyle={{ flexGrow: 1 }}
        alwaysBounceVertical
        keyExtractor={(item) => String(item.id)}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <TouchableOpacity activeOpacity={0.7} onPress={() => onSelectView(item)}>
            <PaintRow paint={item} subSuffix={` · ΔE=${item.de.toFixed(1)}`} ownedCount={ownedCounts.get(item.id) ?? 0} quietOwnedBadge>
              <TouchableOpacity style={styles.addBtn} onPress={() => onSelect(item)} accessibilityRole="button" accessibilityLabel={t('add')}>
                <IconPlus color={colors.primary} size={20} />
              </TouchableOpacity>
            </PaintRow>
          </TouchableOpacity>
        )}
      />
      <ColorCameraPicker
        visible={colorPickerVisible}
        onClose={() => setColorPickerVisible(false)}
        onPick={(picked) => {
          setHex(picked);
          const rgb = hex_to_rgb(picked);
          if (rgb) search(rgb.r, rgb.g, rgb.b);
        }}
      />
      <FilterModal
        visible={showFilter}
        options={filterOptions}
        initial={filter}
        showSearch={false}
        onClose={() => setShowFilter(false)}
        onApply={(next) => {
          const applied = lockedPaintType ? { ...next, types: [lockedPaintType] } : next;
          setFilter(applied);
          setShowFilter(false);
          const rgb = hex_to_rgb(hex);
          if (rgb) search(rgb.r, rgb.g, rgb.b, applied);
        }}
      />
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1 },
  controls: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  inputLabel: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.textSecondary },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  targetSwatch: { width: touch.min, height: touch.min, borderRadius: radius.md, borderCurve: 'continuous', borderWidth: 1, borderColor: colors.border },
  hexInput: { flex: 1, minWidth: 0, height: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, borderCurve: 'continuous', paddingHorizontal: spacing.lg, color: colors.text },
  cameraBtn: { width: touch.min, height: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  matchButton: { minWidth: 64, height: touch.min, paddingHorizontal: spacing.md, borderRadius: radius.md, borderCurve: 'continuous', backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  matchButtonDisabled: { backgroundColor: colors.primaryDisabled },
  matchButtonText: { color: colors.onPrimary, fontSize: 14, fontWeight: '600' },
  filterRow: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filterButton: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderLight, borderRadius: radius.md, borderCurve: 'continuous', backgroundColor: colors.surfaceAlt },
  filterButtonActive: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  filterText: { fontSize: 14, color: colors.textMuted },
  filterTextActive: { color: colors.primaryText, fontWeight: '600' },
  resultSummary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  resultTitle: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  resultCount: { fontSize: 13, color: colors.textFaint, fontVariant: ['tabular-nums'] },
  addBtn: { width: touch.min, height: touch.min, borderRadius: radius.md, borderCurve: 'continuous', backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md },
});
