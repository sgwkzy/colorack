// components/AddPaint/HierarchyBrowser.tsx
import { useEffect, useState, useMemo } from 'react';
import { View, Text, FlatList, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { IconChevronLeft, IconChevronRight, IconPlus } from '@tabler/icons-react-native';
import ClearableInput from '../ClearableInput';
import { getDB, getOwnedCountMap } from '../../lib/db';
import { t } from '../../lib/i18n';
import { brandLabel } from '../../lib/brands';
import { seriesLabel } from '../../lib/paintLabel';
import { useTheme, lightColors, radius, spacing, touch } from '../../lib/theme';
import { useUiPrefs, type ListFontSize } from '../../lib/uiPrefs';
import PaintRow from '../PaintRow';
import ActionSheet, { ActionSheetButton } from '../ActionSheet';
import SwipeBack from '../SwipeBack';
import { swipeDownCloseProps } from '../SwipeDownScrollView';

interface Paint {
  id: number;
  name_ja: string;
  name_en: string | null;
  code: string;
  brand: string;
  series: string;
  series_en: string | null;
  hex: string;
  gloss: string | null;
  paint_type: string | null;
}

interface Props {
  onSelect: (paint: Paint) => void;
  onSelectView: (paint: Paint) => void;
  // 一覧を最上部からさらに引っ張って離した時に親モーダルを閉じる
  onRequestClose?: () => void;
  // paintType が指定された場合、ブランド/シリーズ/塗料の全階層をその種別のみに絞り込む
  paintType?: string;
}

// 階層を横断して「すべて」を表す番兵。実データと衝突しない値。
const ALL = 'ALL';
type Sort = 'name' | 'code';

export default function HierarchyBrowser({ onSelect, onSelectView, onRequestClose, paintType }: Props) {
  const { colors } = useTheme();
  const { listFontSize } = useUiPrefs();
  const styles = useMemo(() => makeStyles(colors, listFontSize), [colors, listFontSize]);
  const closeProps = onRequestClose ? swipeDownCloseProps(onRequestClose) : undefined;
  const [brands, setBrands] = useState<string[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [seriesList, setSeriesList] = useState<{ series: string; series_en: string | null }[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);
  const [paints, setPaints] = useState<Paint[]>([]);
  const [ownedCounts, setOwnedCounts] = useState<Map<number, number>>(new Map());
  const [nameFilter, setNameFilter] = useState('');
  const [sort, setSort] = useState<Sort>('code');
  const [actionSheet, setActionSheet] = useState<{ title: string; buttons: ActionSheetButton[] } | null>(null);

  useEffect(() => {
    const where = paintType ? ' WHERE paint_type = ?' : '';
    const args = paintType ? [paintType] : [];
    getDB().getAllAsync<{ brand: string }>(
      'SELECT DISTINCT brand FROM catalog_paints' + where + ' ORDER BY brand', args
    ).then((rows) => setBrands(rows.map((r) => r.brand)));
  }, [paintType]);

  // brand/series が ALL のときはその条件を外して階層下を全件取得。
  const loadPaints = async (brand: string, series: string, sortBy: Sort = sort) => {
    const where: string[] = [];
    const args: string[] = [];
    if (brand !== ALL) { where.push('brand = ?'); args.push(brand); }
    if (series !== ALL) { where.push('series = ?'); args.push(series); }
    if (paintType) { where.push('paint_type = ?'); args.push(paintType); }
    const sql = 'SELECT id, name_ja, name_en, code, brand, series, series_en, hex, gloss, paint_type FROM catalog_paints'
      + (where.length ? ' WHERE ' + where.join(' AND ') : '')
      + ' ORDER BY ' + (sortBy === 'code' ? 'code COLLATE NOCASE' : 'name_ja COLLATE NOCASE');
    const [rows, ownedMap] = await Promise.all([
      getDB().getAllAsync<Paint>(sql, args),
      getOwnedCountMap(),
    ]);
    setPaints(rows);
    setOwnedCounts(ownedMap);
    setNameFilter('');
  };

  const selectBrand = async (brand: string) => {
    setSelectedBrand(brand);
    setPaints([]);
    if (brand === ALL) { setSelectedSeries(ALL); loadPaints(ALL, ALL); return; }
    setSelectedSeries(null);
    const where = ['brand = ?'];
    const args: string[] = [brand];
    if (paintType) { where.push('paint_type = ?'); args.push(paintType); }
    const rows = await getDB().getAllAsync<{ series: string; series_en: string | null }>(
      'SELECT series, MAX(series_en) AS series_en FROM catalog_paints WHERE ' + where.join(' AND ') + ' GROUP BY series ORDER BY series',
      args
    );
    setSeriesList(rows);
  };

  const selectSeries = (series: string) => {
    setSelectedSeries(series);
    loadPaints(selectedBrand!, series);
  };

  const chooseSort = (next: Sort) => {
    setSort(next);
    if (selectedBrand && selectedSeries) loadPaints(selectedBrand, selectedSeries, next);
  };

  const openSort = () => setActionSheet({
    title: t('sort'),
    buttons: [
      ...(['name', 'code'] as const).map((key): ActionSheetButton => ({
        text: `${sort === key ? '✓ ' : ''}${t(key === 'name' ? 'sortName' : 'sortCode')}`,
        onPress: () => chooseSort(key),
      })),
      { text: t('cancel'), style: 'cancel' },
    ],
  });

  // 塗料一覧の戻り先: brand=ALL のときはブランド一覧へ、それ以外はシリーズ一覧へ。
  const backFromPaints = () => {
    if (selectedBrand === ALL) { setSelectedBrand(null); setSelectedSeries(null); }
    else setSelectedSeries(null);
  };

  const q = nameFilter.trim().toLowerCase();
  const shownPaints = q
    ? paints.filter((p) =>
        p.name_ja.toLowerCase().includes(q)
        || (p.name_en ?? '').toLowerCase().includes(q)
        || (p.code ?? '').toLowerCase().includes(q))
    : paints;

  if (!selectedBrand) {
    return (
      <View style={styles.container}>
        <ScrollView
          style={{ flex: 1 }}
          {...closeProps}
          alwaysBounceVertical
        >
          {[ALL, ...brands].map((item) => (
            <TouchableOpacity key={item} style={[styles.item, item === ALL && styles.allItem]} onPress={() => selectBrand(item)}>
              <Text style={[styles.itemText, item === ALL && styles.allText]}>{item === ALL ? t('all') : brandLabel(item)}</Text>
              <IconChevronRight color={colors.textPlaceholder} size={18} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  if (!selectedSeries) {
    return (
      <SwipeBack enabled onBack={() => setSelectedBrand(null)}>
      <View style={styles.container}>
        <TouchableOpacity style={styles.back} onPress={() => setSelectedBrand(null)}>
          <IconChevronLeft color={colors.primary} size={18} />
          <Text style={styles.backText}>{brandLabel(selectedBrand)}</Text>
        </TouchableOpacity>
        <ScrollView
          style={{ flex: 1 }}
          {...closeProps}
          alwaysBounceVertical
        >
          {[{ series: ALL, series_en: null }, ...seriesList].map((item) => (
            <TouchableOpacity key={item.series} style={[styles.item, item.series === ALL && styles.allItem]} onPress={() => selectSeries(item.series)}>
              <Text style={[styles.itemText, item.series === ALL && styles.allText]}>{item.series === ALL ? t('all') : seriesLabel(item.series, item.series_en)}</Text>
              <IconChevronRight color={colors.textPlaceholder} size={18} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      </SwipeBack>
    );
  }

  return (
    <SwipeBack enabled onBack={backFromPaints}>
    <View style={styles.container}>
      <View style={styles.listHeader}>
        <TouchableOpacity style={[styles.back, styles.listHeaderBack]} onPress={backFromPaints}>
          <IconChevronLeft color={colors.primary} size={18} />
          <Text style={styles.backText} numberOfLines={1}>{selectedSeries === ALL ? (selectedBrand === ALL ? t('all') : brandLabel(selectedBrand)) : seriesLabel(selectedSeries, paints.find((p) => p.series === selectedSeries)?.series_en)}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.sortButton} onPress={openSort} accessibilityRole="button">
          <Text style={styles.sortText}>{t('sort')}</Text>
        </TouchableOpacity>
      </View>
      <ClearableInput
        style={styles.filterInput}
        placeholder={t('colorName')}
        value={nameFilter}
        onChangeText={setNameFilter}
      />
      <FlatList
        key="paints"
        style={{ flex: 1 }}
        data={shownPaints}
        {...closeProps}
        alwaysBounceVertical
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(p) => String(p.id)}
        renderItem={({ item }) => (
          <TouchableOpacity activeOpacity={0.7} onPress={() => onSelectView(item)}>
            <PaintRow paint={item} style={styles.itemPaint} ownedCount={ownedCounts.get(item.id) ?? 0} quietOwnedBadge>
              <TouchableOpacity style={styles.addBtn} onPress={() => onSelect(item)} accessibilityLabel={t('add')}>
                <IconPlus color={colors.primary} size={20} />
              </TouchableOpacity>
            </PaintRow>
          </TouchableOpacity>
        )}
      />
      <ActionSheet
        visible={actionSheet != null}
        title={actionSheet?.title}
        buttons={actionSheet?.buttons ?? []}
        onClose={() => setActionSheet(null)}
      />
    </View>
    </SwipeBack>
  );
}

const makeStyles = (colors: typeof lightColors, listFontSize: ListFontSize) => {
  const ITEM_TEXT_SIZE: Record<ListFontSize, number> = { small: 14, medium: 15, large: 17 };
  return StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-start' },
  item: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  itemPaint: { padding: 14 },
  allItem: { backgroundColor: colors.primarySoft },
  itemText: { flex: 1, fontSize: ITEM_TEXT_SIZE[listFontSize], color: colors.text },
  allText: { color: colors.primaryText, fontWeight: 'bold' },
  addBtn: { width: touch.min, height: touch.min, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md },
  filterInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: spacing.md, margin: spacing.lg },
  listHeader: { flexDirection: 'row', backgroundColor: colors.surfaceAlt },
  back: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  listHeaderBack: { flex: 1 },
  backText: { flexShrink: 1, fontSize: 15, color: colors.primaryText },
  sortButton: { minHeight: touch.min, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  sortText: { fontSize: 14, color: colors.primaryText, fontWeight: 'bold' },
});
};
