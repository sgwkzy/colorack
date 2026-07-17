import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, LayoutAnimation, StyleSheet, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { IconBox, IconShoppingCartPlus } from '@tabler/icons-react-native';
import { useFocusEffect } from 'expo-router';
import { getDB, getDefaultKitBoxId } from '../../lib/db';
import { setAppMode } from '../../lib/appMode';
import { t, useLocale } from '../../lib/i18n';
import { lightColors, radius, spacing, touch, useTheme } from '../../lib/theme';
import ActionSheet, { ActionSheetButton } from '../../components/ActionSheet';
import AddKitModal from '../../components/AddKitModal';
import AdBanner from '../../components/AdBanner';
import EmptyState from '../../components/EmptyState';
import KitFilterModal, { KitFilter } from '../../components/KitFilterModal';
import ListActionBar from '../../components/ListActionBar';
import Toast from '../../components/Toast';

interface CountRow { n: number; }
interface WishlistItem {
  id: number;
  name: string;
  maker: string;
  series: string | null;
  category: string | null;
  scale: string | null;
  note: string | null;
  price: number | null;
  added_at: string;
}

const EMPTY_FILTER: KitFilter = { makers: [], series: [], categories: [], scales: [], search: '' };
type Sort = 'added' | 'name' | 'maker';
const SORT_ORDER: Record<Sort, string> = {
  added: 'added_at DESC',
  name: 'name COLLATE NOCASE ASC',
  maker: 'maker ASC, name ASC',
};

export default function KitWishlistScreen() {
  const locale = useLocale();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filter, setFilter] = useState<KitFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<Sort>('added');
  const [filterOptions, setFilterOptions] = useState<{ maker: string; series: string | null; category: string | null; scale: string | null }[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [actionSheet, setActionSheet] = useState<{ title?: string; message?: string; buttons: ActionSheetButton[] } | null>(null);
  const [toast, setToast] = useState('');
  const [toastAction, setToastAction] = useState<{ label: string; onPress: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeRefs = useRef(new Map<number, Swipeable>());

  const load = useCallback(async (f: KitFilter, sortBy: Sort) => {
    const db = getDB();
    const where: string[] = [];
    const args: string[] = [];
    if (f.makers.length) { where.push(`maker IN (${f.makers.map(() => '?').join(',')})`); args.push(...f.makers); }
    if (f.series.length) { where.push(`series IN (${f.series.map(() => '?').join(',')})`); args.push(...f.series); }
    if (f.categories.length) { where.push(`category IN (${f.categories.map(() => '?').join(',')})`); args.push(...f.categories); }
    if (f.scales.length) { where.push(`scale IN (${f.scales.map(() => '?').join(',')})`); args.push(...f.scales); }
    if (f.search.trim()) { where.push('name LIKE ?'); args.push(`%${f.search.trim()}%`); }
    const [totalRow, options, rows] = await Promise.all([
      db.getFirstAsync<CountRow>('SELECT COUNT(*) AS n FROM kit_wishlist'),
      db.getAllAsync<{ maker: string; series: string | null; category: string | null; scale: string | null }>('SELECT DISTINCT maker, series, category, scale FROM kit_wishlist'),
      db.getAllAsync<WishlistItem>(
        'SELECT id, name, maker, series, category, scale, note, price, added_at FROM kit_wishlist'
        + (where.length ? ` WHERE ${where.join(' AND ')}` : '')
        + ` ORDER BY ${SORT_ORDER[sortBy]}`,
        args
      ),
    ]);
    setTotalCount(totalRow?.n ?? 0);
    setFilterOptions(options);
    setItems(rows);
  }, []);

  useFocusEffect(useCallback(() => {
    setAppMode('kitrack');
    load(filter, sort);
  }, [filter, load, sort]));

  const reload = () => load(filter, sort);
  const filterActive = filter.makers.length > 0 || filter.series.length > 0 || filter.categories.length > 0 || filter.scales.length > 0 || filter.search.trim() !== '';
  const trulyEmpty = !filterActive && totalCount === 0;

  const showToast = (message: string, onUndo: () => void) => {
    setToast(message);
    setToastAction({ label: t('undo'), onPress: onUndo });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => { setToast(''); setToastAction(null); }, 3000);
  };

  const restoreItem = async (item: WishlistItem) => {
    await getDB().runAsync(
      'INSERT INTO kit_wishlist (name, maker, series, category, scale, note, price, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [item.name, item.maker, item.series, item.category, item.scale, item.note, item.price, item.added_at]
    );
    reload();
  };

  const deleteItem = async (item: WishlistItem) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    swipeRefs.current.get(item.id)?.close();
    await getDB().runAsync('DELETE FROM kit_wishlist WHERE id = ?', [item.id]);
    reload();
    showToast(item.name + t('removedToast'), () => restoreItem(item));
  };

  const markPurchased = async (item: WishlistItem) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    swipeRefs.current.get(item.id)?.close();
    const db = getDB();
    const result = await db.runAsync(
      "INSERT INTO kits (box_id, name, maker, series, category, scale, note, price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not_started')",
      [await getDefaultKitBoxId(), item.name, item.maker, item.series, item.category, item.scale, item.note, item.price]
    );
    await db.runAsync('DELETE FROM kit_wishlist WHERE id = ?', [item.id]);
    reload();
    showToast(item.name + t('purchasedToast'), async () => {
      await getDB().runAsync('DELETE FROM kits WHERE id = ?', [result.lastInsertRowId]);
      await restoreItem(item);
    });
  };

  const openSort = () => {
    const options: { key: Sort; label: string }[] = [
      { key: 'added', label: t('sortAdded') },
      { key: 'name', label: t('sortName') },
      { key: 'maker', label: t('sortMaker') },
    ];
    setActionSheet({ title: t('sort'), message: '', buttons: [
      ...options.map((option) => ({ text: `${sort === option.key ? '✓ ' : ''}${option.label}`, onPress: () => setSort(option.key) })),
      { text: t('cancel'), style: 'cancel' as const },
    ] });
  };

  return (
    <View style={styles.container}>
      <View style={styles.statusBarWrap}>
        <Text style={styles.statusCount}>{locale === 'ja' ? `キット数 ${totalCount} ・ 表示数 ${items.length}` : `Kits ${totalCount} · Showing ${items.length}`}</Text>
      </View>
      <View style={styles.adBar}><AdBanner /></View>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Swipeable
            ref={(ref) => { if (ref) swipeRefs.current.set(item.id, ref); else swipeRefs.current.delete(item.id); }}
            renderLeftActions={() => <View style={styles.purchasedAction}><Text style={styles.swipeActionText}>{t('purchased')}</Text></View>}
            renderRightActions={() => <View style={styles.deleteAction}><Text style={styles.swipeActionText}>{t('delete')}</Text></View>}
            onSwipeableOpen={(direction) => { if (direction === 'right') deleteItem(item); else markPurchased(item); }}
            onSwipeableWillOpen={() => swipeRefs.current.forEach((swipeable, id) => { if (id !== item.id) swipeable.close(); })}
            overshootRight={false}
            overshootLeft={false}
          >
            <View style={styles.row}>
              <View style={styles.thumbPlaceholder}><IconBox color={colors.textFaint} size={22} /></View>
              <View style={styles.rowInfo}>
                <Text numberOfLines={1} style={styles.rowName}>{item.name}</Text>
                <Text numberOfLines={1} style={styles.rowSub}>{item.maker}{item.series ? ` · ${item.series}` : ''}{item.scale ? ` · ${item.scale}` : ''}</Text>
              </View>
            </View>
          </Swipeable>
        )}
        ListEmptyComponent={<EmptyState icon={IconShoppingCartPlus} title={trulyEmpty ? t('emptyKits') : t('noResults')} actionLabel={trulyEmpty ? t('addKit') : undefined} onAction={trulyEmpty ? () => setShowAdd(true) : undefined} />}
      />
      <ListActionBar onFilter={() => setShowFilter(true)} onSort={openSort} onAdd={() => setShowAdd(true)} filterActive={filterActive} />
      <KitFilterModal visible={showFilter} options={filterOptions} initial={filter} onApply={(next) => { setFilter(next); setShowFilter(false); }} onClose={() => setShowFilter(false)} />
      <AddKitModal visible={showAdd} defaultBoxId={null} saveTarget="wishlist" onClose={() => { setShowAdd(false); reload(); }} />
      <ActionSheet visible={!!actionSheet} title={actionSheet?.title} message={actionSheet?.message} buttons={actionSheet?.buttons ?? []} onClose={() => setActionSheet(null)} />
      <Toast message={toast} actionLabel={toastAction?.label} onAction={toastAction?.onPress} />
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  statusBarWrap: { minHeight: touch.min, justifyContent: 'center', paddingHorizontal: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.borderLight, backgroundColor: colors.surfaceAlt },
  statusCount: { color: colors.text, fontSize: 15, fontVariant: ['tabular-nums'] },
  adBar: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  list: { paddingBottom: 104 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  thumbPlaceholder: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  purchasedAction: { width: 96, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  deleteAction: { width: 88, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  swipeActionText: { color: colors.onPrimary, fontWeight: 'bold' },
});
