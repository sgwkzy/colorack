// components/AddPaint/TextSearch.tsx
import { useEffect, useState, useMemo } from 'react';
import { View, FlatList, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { IconAdjustmentsHorizontal, IconPlus } from '@tabler/icons-react-native';
import ClearableInput from '../ClearableInput';
import { getDB, getOwnedCountMap } from '../../lib/db';
import { t } from '../../lib/i18n';
import { useTheme, lightColors, radius, spacing, touch } from '../../lib/theme';
import PaintRow from '../PaintRow';
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
}

interface Props {
  onSelect: (paint: Paint) => void;
  onSelectView: (paint: Paint) => void;
  // 一覧を最上部からさらに引っ張って離した時に親モーダルを閉じる
  onRequestClose?: () => void;
}

const EMPTY_FILTER: PaintFilter = { brands: [], series: [], gloss: [], types: [], search: '' };
type FilterOption = { brand: string; series: string; series_en: string | null; gloss: string | null; paint_type: string | null };

export default function TextSearch({ onSelect, onSelectView, onRequestClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const closeProps = onRequestClose ? swipeDownCloseProps(onRequestClose) : undefined;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Paint[]>([]);
  const [ownedCounts, setOwnedCounts] = useState<Map<number, number>>(new Map());
  const [filter, setFilter] = useState<PaintFilter>(EMPTY_FILTER);
  const [filterOptions, setFilterOptions] = useState<FilterOption[]>([]);
  const [showFilter, setShowFilter] = useState(false);

  useEffect(() => {
    getDB().getAllAsync<FilterOption>('SELECT DISTINCT brand, series, series_en, gloss, paint_type FROM catalog_paints')
      .then(setFilterOptions);
  }, []);

  const search = async (q: string, nextFilter: PaintFilter = filter) => {
    setQuery(q);
    const hasFilters = nextFilter.brands.length || nextFilter.series.length || nextFilter.gloss.length || nextFilter.types.length;
    if (!q.trim() && !hasFilters) { setResults([]); return; }
    const db = getDB();
    const where: string[] = [];
    const args: string[] = [];
    if (q.trim()) {
      const like = `%${q.trim()}%`;
      where.push('(name_ja LIKE ? OR name_en LIKE ? OR brand LIKE ? OR series LIKE ?)');
      args.push(like, like, like, like);
    }
    const addIn = (column: string, values: string[]) => {
      if (!values.length) return;
      where.push(`${column} IN (${values.map(() => '?').join(',')})`);
      args.push(...values);
    };
    addIn('brand', nextFilter.brands);
    addIn('series', nextFilter.series);
    addIn('gloss', nextFilter.gloss);
    addIn('paint_type', nextFilter.types);
    const [rows, ownedMap] = await Promise.all([
      db.getAllAsync<Paint>(
        'SELECT id, name_ja, name_en, code, brand, hex, gloss, paint_type FROM catalog_paints'
        + ' WHERE ' + where.join(' AND ') + ' LIMIT 50',
        args
      ),
      getOwnedCountMap(),
    ]);
    setResults(rows);
    setOwnedCounts(ownedMap);
  };

  const filterCount = filter.brands.length + filter.series.length + filter.gloss.length + filter.types.length;
  const filterActive = filterCount > 0;

  return (
    <View style={styles.container}>
      <View style={styles.controls}>
        <Text style={styles.inputLabel}>{t('searchFields')}</Text>
        <ClearableInput
          style={styles.input}
          placeholder={t('searchPlaceholder')}
          value={query}
          onChangeText={search}
        />
        <View style={styles.filterRow}>
          {results.length > 0 ? <View style={styles.resultSummary}>
            <Text style={styles.resultTitle}>{t('textSearch')}</Text>
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
            <PaintRow paint={item} ownedCount={ownedCounts.get(item.id) ?? 0} quietOwnedBadge>
              <TouchableOpacity style={styles.addBtn} onPress={() => onSelect(item)} accessibilityLabel={t('add')}>
                <IconPlus color={colors.primary} size={20} />
              </TouchableOpacity>
            </PaintRow>
          </TouchableOpacity>
        )}
        ListEmptyComponent={query || filterActive ? <Text style={styles.empty}>{t('noResults')}</Text> : null}
      />
      <FilterModal
        visible={showFilter}
        options={filterOptions}
        initial={filter}
        showSearch={false}
        onClose={() => setShowFilter(false)}
        onApply={(next) => { setFilter(next); setShowFilter(false); search(query, next); }}
      />
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1 },
  controls: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  inputLabel: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.textSecondary },
  input: { height: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, borderCurve: 'continuous', paddingHorizontal: spacing.lg, color: colors.text },
  filterRow: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filterButton: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderLight, borderRadius: radius.md, borderCurve: 'continuous', backgroundColor: colors.surfaceAlt },
  filterButtonActive: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  filterText: { fontSize: 14, color: colors.textMuted },
  filterTextActive: { color: colors.primaryText, fontWeight: '600' },
  resultSummary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  resultTitle: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  resultCount: { fontSize: 13, color: colors.textFaint, fontVariant: ['tabular-nums'] },
  addBtn: { width: touch.min, height: touch.min, borderRadius: radius.md, borderCurve: 'continuous', backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md },
  empty: { textAlign: 'center', marginTop: spacing.xxl, color: colors.textPlaceholder },
});
