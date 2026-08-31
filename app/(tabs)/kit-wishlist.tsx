import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, LayoutAnimation, StyleSheet, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { IconShoppingCartPlus } from '@tabler/icons-react-native';
import { useFocusEffect, useNavigation } from 'expo-router';
import { getDB, type KitWishlistItem, removeKitWishlistItem, restoreKitWishlistItem } from '../../lib/db';
import { setAppMode } from '../../lib/appMode';
import { t, useLocale } from '../../lib/i18n';
import { lightColors, spacing, touch, useTheme } from '../../lib/theme';
import ActionSheet, { ActionSheetButton } from '../../components/ActionSheet';
import AddKitModal from '../../components/AddKitModal';
import AdBanner from '../../components/AdBanner';
import EmptyState from '../../components/EmptyState';
import KitFilterModal, { KitFilter } from '../../components/KitFilterModal';
import ListActionBar, { ListToolbar } from '../../components/ListActionBar';
import Toast from '../../components/Toast';

interface CountRow { n: number; }

const EMPTY_FILTER: KitFilter = { makers: [], series: [], categories: [], scales: [], search: '' };

type KitWishlistSort = 'added' | 'name' | 'maker';
const SORT_SQL: Record<KitWishlistSort, string> = {
  added: 'added_at DESC',
  name: 'name COLLATE NOCASE ASC',
  maker: 'maker COLLATE NOCASE ASC, name COLLATE NOCASE ASC',
};

export default function KitWishlistScreen() {
  const locale = useLocale();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<KitWishlistItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filter, setFilter] = useState<KitFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<KitWishlistSort>('added');
  const [filterOptions, setFilterOptions] = useState<{ maker: string; series: string | null; category: string | null; scale: string | null }[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [actionSheet, setActionSheet] = useState<{ title?: string; message?: string; buttons: ActionSheetButton[] } | null>(null);
  const [toast, setToast] = useState('');
  const [toastAction, setToastAction] = useState<{ label: string; onPress: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeRefs = useRef(new Map<number, Swipeable>());
  const loadVersionRef = useRef(0);

  useEffect(() => {
    navigation.setOptions({ title: t('kitWishlist') });
  }, [locale, navigation]);

  const load = useCallback(async (f: KitFilter, sortBy: KitWishlistSort) => {
    const loadVersion = ++loadVersionRef.current;
    const db = getDB();
    const where: string[] = [];
    const args: string[] = [];

    if (f.makers.length) { where.push(`maker IN (${f.makers.map(() => '?').join(',')})`); args.push(...f.makers); }
    if (f.series.length) { where.push(`series IN (${f.series.map(() => '?').join(',')})`); args.push(...f.series); }
    if (f.categories.length) { where.push(`category IN (${f.categories.map(() => '?').join(',')})`); args.push(...f.categories); }
    if (f.scales.length) { where.push(`scale IN (${f.scales.map(() => '?').join(',')})`); args.push(...f.scales); }
    if (f.search.trim()) { where.push('name LIKE ?'); args.push(`%${f.search.trim()}%`); }

    const sql =
      'SELECT id, name, maker, series, category, scale, price, note, added_at FROM kit_wishlist' +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY ' + SORT_SQL[sortBy];

    const [totalRow, nextFilterOptions, nextItems] = await Promise.all([
      db.getFirstAsync<CountRow>('SELECT COUNT(*) AS n FROM kit_wishlist'),
      db.getAllAsync<{ maker: string; series: string | null; category: string | null; scale: string | null }>(
        'SELECT DISTINCT maker, series, category, scale FROM kit_wishlist'
      ),
      db.getAllAsync<KitWishlistItem>(sql, args),
    ]);
    if (loadVersion !== loadVersionRef.current) return;
    setTotalCount(totalRow?.n ?? 0);
    setFilterOptions(nextFilterOptions);
    setItems(nextItems);
  }, []);

  useFocusEffect(useCallback(() => {
    setAppMode('kitrack');
    void load(filter, sort);
  }, [filter, load, sort]));

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const reload = () => load(filter, sort);
  const filterActive = filter.makers.length > 0 || filter.series.length > 0 || filter.categories.length > 0 || filter.scales.length > 0 || filter.search.trim() !== '';
  const trulyEmpty = !filterActive && totalCount === 0;
  const emptyMessage = trulyEmpty ? t('emptyKits') : t('noResults');

  const showToast = (message: string, actionLabel?: string, onAction?: () => void) => {
    setToast(message);
    setToastAction(actionLabel && onAction ? { label: actionLabel, onPress: onAction } : null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToast('');
      setToastAction(null);
    }, actionLabel ? 3000 : 1800);
  };

  const deleteItem = async (item: KitWishlistItem) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    swipeRefs.current.get(item.id)?.close();
    let removed: KitWishlistItem | null;
    try {
      removed = await removeKitWishlistItem(item.id);
    } catch (error) {
      console.error('KitWishlistScreen: failed to delete candidate', error);
      Alert.alert(t('error'), t('saveFailed'));
      return;
    }
    if (!removed) return;
    showToast(item.name + t('removedToast'), t('undo'), async () => {
      try {
        await restoreKitWishlistItem(removed);
      } catch (error) {
        console.error('KitWishlistScreen: failed to undo candidate deletion', error);
        Alert.alert(t('error'), t('saveFailed'));
        return;
      }
      try {
        await reload();
      } catch (error) {
        console.error('KitWishlistScreen: failed to reload after undo', error);
        Alert.alert(t('error'), t('loadFailed'));
      }
    });
    try {
      await reload();
    } catch (error) {
      console.error('KitWishlistScreen: failed to reload after deletion', error);
      Alert.alert(t('error'), t('loadFailed'));
    }
  };

  const openSort = () => {
    const opts: { key: KitWishlistSort; label: string }[] = [
      { key: 'added', label: t('sortAdded') },
      { key: 'name', label: t('sortName') },
      { key: 'maker', label: t('sortMaker') },
    ];
    setActionSheet({ title: t('sort'), message: '', buttons: [
      ...opts.map((option) => ({ text: `${sort === option.key ? '✓ ' : ''}${option.label}`, onPress: () => setSort(option.key) })),
      { text: t('cancel'), style: 'cancel' as const },
    ] });
  };

  return (
    <View style={styles.container}>
      <View style={styles.statusBarWrap}>
        <Text style={styles.statusCount}>{t('kitCount', { total: totalCount, shown: items.length })}</Text>
        <ListToolbar onFilter={() => setShowFilter(true)} onSort={openSort} filterActive={filterActive} />
      </View>
      <View style={styles.adBar}><AdBanner /></View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Swipeable
            ref={(ref) => { if (ref) swipeRefs.current.set(item.id, ref); else swipeRefs.current.delete(item.id); }}
            renderRightActions={() => <View style={styles.deleteAction}><Text style={styles.swipeActionText}>{t('delete')}</Text></View>}
            onSwipeableOpen={(direction) => { if (direction === 'right') void deleteItem(item); }}
            onSwipeableWillOpen={() => swipeRefs.current.forEach((swipeable, id) => { if (id !== item.id) swipeable.close(); })}
            overshootRight={false}
            overshootLeft={false}
          >
            <View
              style={styles.row}
              accessible
              accessibilityLabel={item.name}
              accessibilityActions={[{ name: 'delete', label: t('delete') }]}
              onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === 'delete') void deleteItem(item); }}
            >
              <View style={styles.rowInfo}>
                <Text numberOfLines={1} style={styles.rowName}>{item.name}</Text>
                <Text numberOfLines={1} style={styles.rowSub}>
                  {[item.maker, item.series, item.scale].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
          </Swipeable>
        )}
        ListEmptyComponent={(
          <EmptyState
            icon={IconShoppingCartPlus}
            title={emptyMessage}
            actionLabel={trulyEmpty ? t('addKit') : undefined}
            onAction={trulyEmpty ? () => setShowAdd(true) : undefined}
          />
        )}
      />

      <ListActionBar onAdd={() => setShowAdd(true)} />
      <KitFilterModal
        visible={showFilter}
        options={filterOptions}
        initial={filter}
        onApply={(nextFilter) => { setFilter(nextFilter); setShowFilter(false); }}
        onClose={() => setShowFilter(false)}
      />
      <AddKitModal
        visible={showAdd}
        defaultBoxId={null}
        saveTarget="wishlist"
        onClose={() => { setShowAdd(false); void reload(); }}
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
  adBar: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  statusBarWrap: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.borderLight, backgroundColor: colors.surfaceAlt },
  statusCount: { color: colors.text, fontSize: 15, fontVariant: ['tabular-nums'] },
  list: { paddingBottom: 104 },
  row: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  deleteAction: { width: 88, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  swipeActionText: { color: colors.onPrimary, fontWeight: 'bold' },
});
