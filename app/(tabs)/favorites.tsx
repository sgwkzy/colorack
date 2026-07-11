// app/(tabs)/favorites.tsx
import { useCallback, useRef, useState, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, LayoutAnimation } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { IconHeart } from '@tabler/icons-react-native';
import { useFocusEffect } from 'expo-router';
import { getDB } from '../../lib/db';
import { t, useLocale } from '../../lib/i18n';
import { paintName } from '../../lib/paintLabel';
import { useTheme, lightColors, spacing, touch } from '../../lib/theme';
import AddPaintModal from '../../components/AddPaint';
import ActionSheet, { ActionSheetButton } from '../../components/ActionSheet';
import AdBanner from '../../components/AdBanner';
import EmptyState from '../../components/EmptyState';
import FilterModal, { PaintFilter } from '../../components/FilterModal';
import PaintDetailModal from '../../components/PaintDetailModal';
import PaintRow from '../../components/PaintRow';
import Toast from '../../components/Toast';
import ListActionBar from '../../components/ListActionBar';

interface ListItem {
  id: number;
  paint_id: number;
  name_ja: string;
  name_en: string | null;
  code: string;
  brand: string;
  hex: string;
  gloss: string | null;
  paint_type: string | null;
}
interface CountRow { n: number; }

const EMPTY_FILTER: PaintFilter = { brands: [], series: [], gloss: [], types: [], search: '' };

type Sort = 'added' | 'name' | 'brand' | 'code';
const SORT_ORDER: Record<Sort, string> = {
  added: 'l.added_at DESC',
  name: 'c.name_ja COLLATE NOCASE ASC',
  brand: 'c.brand ASC, c.name_ja ASC',
  code: 'c.code COLLATE NOCASE ASC',
};

export default function FavoritesScreen() {
  const locale = useLocale();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<ListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filter, setFilter] = useState<PaintFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<Sort>('added');
  const [filterOptions, setFilterOptions] = useState<{ brand: string; series: string; series_en: string | null; gloss: string | null; paint_type: string | null }[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [detailPaintId, setDetailPaintId] = useState<number | null>(null);
  const [actionSheet, setActionSheet] = useState<{ title?: string; message?: string; buttons: ActionSheetButton[] } | null>(null);
  const [toast, setToast] = useState('');
  const [toastAction, setToastAction] = useState<{ label: string; onPress: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeRefs = useRef(new Map<number, Swipeable>());

  const load = useCallback(async (f: PaintFilter, sortBy: Sort) => {
    const db = getDB();
    const totalRow = await db.getFirstAsync<CountRow>('SELECT COUNT(*) AS n FROM lists WHERE type = ?', ['favorites']);
    setTotalCount(totalRow?.n ?? 0);
    setFilterOptions(await db.getAllAsync<{ brand: string; series: string; series_en: string | null; gloss: string | null; paint_type: string | null }>(
      'SELECT DISTINCT c.brand, c.series, c.series_en, c.gloss, c.paint_type FROM lists l'
      + ' JOIN catalog_paints c ON l.paint_id = c.id'
      + ' WHERE l.type = ?',
      ['favorites']
    ));

    const where: string[] = ['l.type = ?'];
    const args: string[] = ['favorites'];

    if (f.brands.length) {
      where.push(`c.brand IN (${f.brands.map(() => '?').join(',')})`);
      args.push(...f.brands);
    }
    if (f.series.length) {
      where.push(`c.series IN (${f.series.map(() => '?').join(',')})`);
      args.push(...f.series);
    }
    if (f.gloss.length) {
      where.push(`c.gloss IN (${f.gloss.map(() => '?').join(',')})`);
      args.push(...f.gloss);
    }
    if (f.types.length) {
      where.push(`c.paint_type IN (${f.types.map(() => '?').join(',')})`);
      args.push(...f.types);
    }
    if (f.search.trim()) {
      const like = `%${f.search.trim()}%`;
      where.push('(c.name_ja LIKE ? OR c.name_en LIKE ?)');
      args.push(like, like);
    }

    const rows = await db.getAllAsync<ListItem>(
      'SELECT l.id, l.paint_id, c.name_ja, c.name_en, c.code, c.brand, c.hex, c.gloss, c.paint_type'
      + ' FROM lists l JOIN catalog_paints c ON l.paint_id = c.id'
      + ' WHERE ' + where.join(' AND ')
      + ' ORDER BY ' + SORT_ORDER[sortBy],
      args
    );
    setItems(rows);
  }, []);

  useFocusEffect(useCallback(() => { load(filter, sort); }, [load, filter, sort]));

  const reload = () => load(filter, sort);
  const filterActive = filter.brands.length > 0 || filter.series.length > 0 || filter.gloss.length > 0 || filter.types.length > 0 || filter.search.trim() !== '';
  const trulyEmpty = !filterActive && totalCount === 0;
  const emptyMessage = trulyEmpty ? t('emptyList') : t('noResults');

  const showToast = (message: string, actionLabel?: string, onAction?: () => void) => {
    setToast(message);
    setToastAction(actionLabel && onAction ? { label: actionLabel, onPress: onAction } : null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => { setToast(''); setToastAction(null); }, actionLabel ? 3000 : 1800);
  };

  const deleteItem = async (item: ListItem) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    swipeRefs.current.get(item.id)?.close();
    await getDB().runAsync('DELETE FROM lists WHERE id = ?', [item.id]);
    reload();
    showToast(
      paintName(item.name_ja, item.name_en) + t('removedToast'),
      t('undo'),
      async () => {
        await getDB().runAsync("INSERT OR IGNORE INTO lists (type, paint_id) VALUES ('favorites', ?)", [item.paint_id]);
        reload();
      }
    );
  };

  const openSort = () => {
    const opts: { key: Sort; label: string }[] = [
      { key: 'added', label: t('sortAdded') },
      { key: 'name', label: t('sortName') },
      { key: 'brand', label: t('sortBrand') },
      { key: 'code', label: t('sortCode') },
    ];
    setActionSheet({ title: t('sort'), message: '', buttons: [
      ...opts.map((o) => ({ text: `${sort === o.key ? '✓ ' : ''}${o.label}`, onPress: () => setSort(o.key) })),
      { text: t('cancel'), style: 'cancel' as const },
    ] });
  };

  return (
    <View style={styles.container}>
      <View style={styles.statusBarWrap}>
        <Text style={styles.statusCount}>{locale === 'ja' ? `塗料数 ${totalCount} ・ 表示数 ${items.length}` : `Paints ${totalCount} · Showing ${items.length}`}</Text>
      </View>
      <View style={styles.adBar}><AdBanner /></View>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <Swipeable
            ref={(r) => { if (r) swipeRefs.current.set(item.id, r); else swipeRefs.current.delete(item.id); }}
            overshootRight={false}
            renderRightActions={() => (
              <View style={styles.deleteAction}>
                <Text style={styles.deleteActionText}>{t('delete')}</Text>
              </View>
            )}
            onSwipeableOpen={(direction) => {
              if (direction === 'right') deleteItem(item);
            }}
          >
            <TouchableOpacity onPress={() => setDetailPaintId(item.paint_id)}>
              <PaintRow paint={item} />
            </TouchableOpacity>
          </Swipeable>
        )}
        ListEmptyComponent={(
          <EmptyState
            icon={IconHeart}
            title={emptyMessage}
            actionLabel={trulyEmpty ? t('addPaint') : undefined}
            onAction={trulyEmpty ? () => setShowAdd(true) : undefined}
          />
        )}
        contentContainerStyle={{ paddingBottom: 104 }}
      />
      <ListActionBar onFilter={() => setShowFilter(true)} onSort={openSort} onAdd={() => setShowAdd(true)} filterActive={filterActive} />
      <FilterModal
        visible={showFilter}
        options={filterOptions}
        initial={filter}
        onApply={(f) => { setFilter(f); setShowFilter(false); }}
        onClose={() => setShowFilter(false)}
      />
      <AddPaintModal
        visible={showAdd}
        onClose={() => { setShowAdd(false); reload(); }}
        defaultStatus="favorites"
      />
      <PaintDetailModal
        visible={detailPaintId != null}
        paintId={detailPaintId}
        onClose={() => setDetailPaintId(null)}
        onChanged={reload}
      />
      <ActionSheet
        visible={!!actionSheet}
        title={actionSheet?.title}
        message={actionSheet?.message}
        buttons={actionSheet?.buttons ?? []}
        onClose={() => setActionSheet(null)}
      />
      <Toast message={toast} actionLabel={toastAction?.label} onAction={toastAction?.onPress} />
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  statusBarWrap: { minHeight: touch.min, justifyContent: 'center', paddingHorizontal: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.borderLight, backgroundColor: colors.surfaceAlt },
  statusCount: { color: colors.text, fontSize: 15, fontVariant: ['tabular-nums'] },
  adBar: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  deleteAction: { backgroundColor: colors.danger, justifyContent: 'center', alignItems: 'center', width: 88 },
  deleteActionText: { color: colors.onPrimary, fontWeight: 'bold' },
});
