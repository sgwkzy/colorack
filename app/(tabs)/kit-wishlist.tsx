import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Image, LayoutAnimation, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { IconBox, IconShoppingCartPlus } from '@tabler/icons-react-native';
import { useFocusEffect, useNavigation } from 'expo-router';
import { getDB, moveKitWishlistItemToBox, type KitWishlistItem, removeKitWishlistItem, restoreKitWishlistItem, undoKitWishlistMove } from '../../lib/db';
import { deleteKitPhoto } from '../../lib/kitPhoto';
import { setAppMode } from '../../lib/appMode';
import { t, useLocale } from '../../lib/i18n';
import { lightColors, radius, spacing, touch, useTheme } from '../../lib/theme';
import ActionSheet, { ActionSheetButton } from '../../components/ActionSheet';
import AddKitModal from '../../components/AddKitModal';
import AdBanner from '../../components/AdBanner';
import EmptyState from '../../components/EmptyState';
import KitFilterModal, { KitFilter } from '../../components/KitFilterModal';
import KitWishlistDetailModal from '../../components/KitWishlistDetailModal';
import ListActionBar, { ListToolbar } from '../../components/ListActionBar';
import Toast from '../../components/Toast';

interface CountRow { n: number; }
interface KitBoxChoice { id: number; name: string; }
interface KitWishlistListItem extends KitWishlistItem { thumb_uri: string | null; }

const EMPTY_FILTER: KitFilter = { makers: [], series: [], categories: [], scales: [], search: '' };

type KitWishlistSort = 'added' | 'name' | 'maker';
const SORT_SQL: Record<KitWishlistSort, string> = {
  added: 'added_at DESC',
  name: 'name COLLATE NOCASE ASC',
  maker: 'maker COLLATE NOCASE ASC, name COLLATE NOCASE ASC',
};

function kitWishlistActionForOpenedSide(direction: 'left' | 'right'): 'move' | 'delete' {
  return direction === 'right' ? 'delete' : 'move';
}

export default function KitWishlistScreen() {
  const locale = useLocale();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<KitWishlistListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filter, setFilter] = useState<KitFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<KitWishlistSort>('added');
  const [filterOptions, setFilterOptions] = useState<{ maker: string; series: string | null; category: string | null; scale: string | null }[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [actionSheet, setActionSheet] = useState<{ title?: string; message?: string; buttons: ActionSheetButton[] } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [loadState, setLoadState] = useState<'ready' | 'error'>('ready');
  const [toast, setToast] = useState('');
  const [toastAction, setToastAction] = useState<{ label: string; onPress: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastCleanupRef = useRef<(() => void | Promise<void>) | null>(null);
  const toastGenerationRef = useRef(0);
  const swipeRefs = useRef(new Map<number, Swipeable>());
  const loadVersionRef = useRef(0);
  const busyIdRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<number | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: t('kitWishlist') });
  }, [locale, navigation]);

  const load = useCallback(async (f: KitFilter, sortBy: KitWishlistSort) => {
    const loadVersion = ++loadVersionRef.current;
    try {
      const db = getDB();
      const where: string[] = [];
      const args: string[] = [];

      if (f.makers.length) { where.push(`maker IN (${f.makers.map(() => '?').join(',')})`); args.push(...f.makers); }
      if (f.series.length) { where.push(`series IN (${f.series.map(() => '?').join(',')})`); args.push(...f.series); }
      if (f.categories.length) { where.push(`category IN (${f.categories.map(() => '?').join(',')})`); args.push(...f.categories); }
      if (f.scales.length) { where.push(`scale IN (${f.scales.map(() => '?').join(',')})`); args.push(...f.scales); }
      if (f.search.trim()) { where.push('name LIKE ?'); args.push(`%${f.search.trim()}%`); }

      const sql =
        'SELECT id, name, maker, series, category, scale, price, note, added_at,'
        + ' (SELECT uri FROM kit_wishlist_photos WHERE wishlist_id = kit_wishlist.id ORDER BY sort_order, id LIMIT 1) AS thumb_uri'
        + ' FROM kit_wishlist' +
        (where.length ? ' WHERE ' + where.join(' AND ') : '') +
        ' ORDER BY ' + SORT_SQL[sortBy];

      const [totalRow, nextFilterOptions, nextItems] = await Promise.all([
        db.getFirstAsync<CountRow>('SELECT COUNT(*) AS n FROM kit_wishlist'),
        db.getAllAsync<{ maker: string; series: string | null; category: string | null; scale: string | null }>(
          'SELECT DISTINCT maker, series, category, scale FROM kit_wishlist'
        ),
        db.getAllAsync<KitWishlistListItem>(sql, args),
      ]);
      if (loadVersion !== loadVersionRef.current) return;
      setTotalCount(totalRow?.n ?? 0);
      setFilterOptions(nextFilterOptions);
      setItems(nextItems);
      setLoadState('ready');
    } catch (error) {
      if (loadVersion !== loadVersionRef.current) return;
      console.error('KitWishlistScreen: failed to load candidates', error);
      setLoadState('error');
    }
  }, []);

  useFocusEffect(useCallback(() => {
    setAppMode('kitrack');
    void load(filter, sort);
  }, [filter, load, sort]));

  const clearToast = (runCleanup: boolean) => {
    toastGenerationRef.current += 1;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = null;
    const cleanup = toastCleanupRef.current;
    toastCleanupRef.current = null;
    setToast('');
    setToastAction(null);
    if (runCleanup && cleanup) void cleanup();
  };

  useEffect(() => () => {
    clearToast(true);
  }, []);

  const reload = () => load(filter, sort);
  const filterActive = filter.makers.length > 0 || filter.series.length > 0 || filter.categories.length > 0 || filter.scales.length > 0 || filter.search.trim() !== '';
  const trulyEmpty = !filterActive && totalCount === 0;
  const emptyMessage = trulyEmpty ? t('emptyKitWishlist') : t('noResults');

  const showToast = (message: string, actionLabel?: string, onAction?: () => void, onExpire?: () => void | Promise<void>) => {
    clearToast(true);
    const generation = toastGenerationRef.current;
    setToast(message);
    setToastAction(actionLabel && onAction ? { label: actionLabel, onPress: () => {
      if (generation !== toastGenerationRef.current) return;
      toastGenerationRef.current += 1;
      onAction();
    } } : null);
    toastCleanupRef.current = onExpire ?? null;
    toastTimer.current = setTimeout(() => clearToast(true), actionLabel ? 3000 : 1800);
  };

  const clearBusy = (id: number) => {
    if (busyIdRef.current !== id) return;
    busyIdRef.current = null;
    setBusyId(null);
  };

  const moveToBox = async (item: KitWishlistItem, boxId: number) => {
    if (busyIdRef.current != null) return;
    busyIdRef.current = item.id;
    setBusyId(item.id);
    swipeRefs.current.get(item.id)?.close();
    let moved: Awaited<ReturnType<typeof moveKitWishlistItemToBox>>;
    try {
      moved = await moveKitWishlistItemToBox(item.id, boxId);
    } catch (error) {
      console.error('KitWishlistScreen: failed to move candidate', error);
      Alert.alert(t('error'), t('saveFailed'));
      clearBusy(item.id);
      return;
    }
    showToast(t('kitMovedToBoxToast'), t('undo'), async () => {
      try {
        await undoKitWishlistMove(moved.kitId, moved.snapshot);
      } catch (error) {
        console.error('KitWishlistScreen: failed to undo candidate move', error);
        Alert.alert(t('error'), t('saveFailed'));
        return;
      }
      try {
        await reload();
      } catch (error) {
        console.error('KitWishlistScreen: failed to reload after undoing candidate move', error);
        Alert.alert(t('error'), t('loadFailed'));
      }
    });
    try {
      await reload();
    } catch (error) {
      console.error('KitWishlistScreen: failed to reload after moving candidate', error);
      Alert.alert(t('error'), t('loadFailed'));
    } finally {
      clearBusy(item.id);
    }
  };

  const requestMove = async (item: KitWishlistItem) => {
    if (busyIdRef.current != null) return;
    busyIdRef.current = item.id;
    setBusyId(item.id);
    swipeRefs.current.get(item.id)?.close();
    let boxes: KitBoxChoice[];
    try {
      boxes = await getDB().getAllAsync<KitBoxChoice>('SELECT id, name FROM kit_boxes ORDER BY sort_order, id');
    } catch (error) {
      console.error('KitWishlistScreen: failed to load kit Boxes', error);
      Alert.alert(t('error'), t('loadFailed'));
      clearBusy(item.id);
      return;
    }
    if (boxes.length === 0) {
      clearBusy(item.id);
      Alert.alert(t('error'), t('noKitBoxAvailable'));
      return;
    }
    if (boxes.length === 1) {
      clearBusy(item.id);
      await moveToBox(item, boxes[0].id);
      return;
    }
    pendingMoveRef.current = item.id;
    setActionSheet({ title: t('targetBox'), buttons: [
      ...boxes.map((box) => ({ text: box.name, onPress: () => void moveToBox(item, box.id) })),
      { text: t('cancel'), style: 'cancel' as const },
    ] });
  };

  const deleteItem = async (item: KitWishlistItem) => {
    if (busyIdRef.current != null) return;
    busyIdRef.current = item.id;
    setBusyId(item.id);
    try {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      swipeRefs.current.get(item.id)?.close();
      let removed: Awaited<ReturnType<typeof removeKitWishlistItem>>;
      try {
        removed = await removeKitWishlistItem(item.id);
      } catch (error) {
        console.error('KitWishlistScreen: failed to delete candidate', error);
        Alert.alert(t('error'), t('saveFailed'));
        return;
      }
      if (!removed) return;
      const removedSnapshot = removed;
      showToast(item.name + t('removedToast'), t('undo'), async () => {
        clearToast(false);
        try {
          await restoreKitWishlistItem(removedSnapshot);
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
      }, async () => {
        for (const photo of removedSnapshot.photos) {
          try {
            await deleteKitPhoto(photo.uri);
          } catch (error) {
            console.error('KitWishlistScreen: failed to clean up deleted candidate photo', photo.uri, error);
          }
        }
      });
      try {
        await reload();
      } catch (error) {
        console.error('KitWishlistScreen: failed to reload after deletion', error);
        Alert.alert(t('error'), t('loadFailed'));
      }
    } finally {
      clearBusy(item.id);
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
      {loadState === 'error' ? (
        <View style={styles.loadError}>
          <Text accessibilityRole="alert" style={styles.loadErrorText}>{t('loadFailed')}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => void reload()} style={styles.retryButton}>
            <Text style={styles.retryText}>{t('retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const rowDetails = [item.maker, item.series, item.scale, item.price != null ? `${t('price')} ${item.price.toLocaleString()}` : null].filter(Boolean);
          return (
            <Swipeable
              ref={(ref) => { if (ref) swipeRefs.current.set(item.id, ref); else swipeRefs.current.delete(item.id); }}
              renderLeftActions={() => <View style={styles.moveAction}><Text numberOfLines={1} style={styles.swipeActionText}>{t('moveToBox')}</Text></View>}
              renderRightActions={() => <View style={styles.deleteAction}><Text style={styles.swipeActionText}>{t('delete')}</Text></View>}
              onSwipeableOpen={(direction) => { const action = kitWishlistActionForOpenedSide(direction); if (action === 'delete') void deleteItem(item); else void requestMove(item); }}
              onSwipeableWillOpen={() => swipeRefs.current.forEach((swipeable, id) => { if (id !== item.id) swipeable.close(); })}
              overshootRight={false}
              overshootLeft={false}
            >
              <TouchableOpacity
                style={styles.row}
                accessible
                onPress={() => { if (busyIdRef.current == null) setDetailId(item.id); }}
                disabled={busyId != null}
                accessibilityRole="button"
                accessibilityLabel={[item.name, ...rowDetails].filter(Boolean).join(' · ')}
                accessibilityHint={t('kitWishlistActionsHint')}
                accessibilityState={{ busy: busyId === item.id, disabled: busyId != null }}
                accessibilityActions={[{ name: 'delete', label: t('delete') }, { name: 'move', label: t('moveToBox') }]}
                onAccessibilityAction={({ nativeEvent }) => { if (busyIdRef.current != null) return; if (nativeEvent.actionName === 'delete') void deleteItem(item); if (nativeEvent.actionName === 'move') void requestMove(item); }}
              >
                {item.thumb_uri ? (
                  <Image source={{ uri: item.thumb_uri }} style={styles.thumb} resizeMode="cover" />
                ) : (
                  <View style={styles.thumbPlaceholder}><IconBox color={colors.textFaint} size={22} /></View>
                )}
                <View style={styles.rowInfo}>
                  <Text numberOfLines={1} style={styles.rowName}>{item.name}</Text>
                  <Text numberOfLines={1} style={styles.rowSub}>{rowDetails.join(' · ')}</Text>
                </View>
              </TouchableOpacity>
            </Swipeable>
          );
        }}
        ListEmptyComponent={loadState === 'error' ? null : (
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
      <KitWishlistDetailModal
        visible={detailId != null}
        wishlistId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={reload}
        onMove={(item) => { setDetailId(null); void requestMove(item); }}
        onDelete={(item) => { setDetailId(null); void deleteItem(item); }}
      />
      <ActionSheet
        visible={!!actionSheet}
        title={actionSheet?.title}
        message={actionSheet?.message}
        buttons={actionSheet?.buttons ?? []}
        onClose={() => {
          setActionSheet(null);
          if (pendingMoveRef.current != null) {
            const pendingId = pendingMoveRef.current;
            pendingMoveRef.current = null;
            clearBusy(pendingId);
          }
        }}
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
  loadError: { alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  loadErrorText: { color: colors.textMuted },
  retryButton: { minHeight: touch.min, paddingHorizontal: spacing.xl, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.primary },
  retryText: { color: colors.onPrimary, fontWeight: '700' },
  row: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight, backgroundColor: colors.surface },
  thumb: { width: 48, height: 48, borderRadius: radius.sm },
  thumbPlaceholder: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  moveAction: { width: 128, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  deleteAction: { width: 88, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  swipeActionText: { color: colors.onPrimary, fontWeight: 'bold' },
});
