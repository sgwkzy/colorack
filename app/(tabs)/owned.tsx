// app/(tabs)/owned.tsx
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, LayoutAnimation, Modal, Pressable,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { IconBox, IconChevronDown } from '@tabler/icons-react-native';
import { router, useFocusEffect, useLocalSearchParams, useNavigation, usePathname } from 'expo-router';
import { getDB, getDefaultBoxId, getListMembership, PaintStatus, setInventoryStatus } from '../../lib/db';
import { setActiveBox } from '../../lib/activeBox';
import { getLocale, t } from '../../lib/i18n';
import { paintName } from '../../lib/paintLabel';
import { useTheme, lightColors, radius, spacing, touch } from '../../lib/theme';
import AddPaintModal from '../../components/AddPaint';
import AdBanner from '../../components/AdBanner';
import ActionSheet, { ActionSheetButton } from '../../components/ActionSheet';
import EmptyState from '../../components/EmptyState';
import FilterModal, { PaintFilter } from '../../components/FilterModal';
import InventoryDetailModal from '../../components/InventoryDetailModal';
import PaintRow from '../../components/PaintRow';
import Toast from '../../components/Toast';
import ListActionBar from '../../components/ListActionBar';

interface CountRow { n: number; }

interface InventoryItem {
  id: number;
  paint_id: number;
  name_ja: string;
  name_en: string | null;
  code: string;
  brand: string;
  hex: string;
  gloss: string | null;
  paint_type: string | null;
  status: PaintStatus;
  box_id: number | null;
}

// 'all' = 一覧(ボックス横断), number = そのボックス
type Selected = 'all' | number;

// 保管箱では在庫と使用中だけを選択する。使用済は専用一覧で表示する。
const STATUS_TOGGLES: { key: PaintStatus; label: string }[] = [
  { key: 'owned', label: 'statusOwned' },
  { key: 'in_use', label: 'statusInUse' },
];

const EMPTY_FILTER: PaintFilter = { brands: [], series: [], gloss: [], types: [], search: '' };

type Sort = 'added' | 'name' | 'brand' | 'code';
const SORT_ORDER: Record<Sort, string> = {
  added: 'i.added_at DESC',
  name: 'c.name_ja COLLATE NOCASE ASC',
  brand: 'c.brand ASC, c.name_ja ASC',
  code: 'c.code COLLATE NOCASE ASC',
};

export default function OwnedScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const pathname = usePathname();
  const navigation = useNavigation();
  const isUsedScreen = pathname.endsWith('/used');
  const { boxId } = useLocalSearchParams<{ boxId?: string }>();
  const [inventoryTotal, setInventoryTotal] = useState(0);
  const [selected, setSelected] = useState<Selected>('all');
  const [statuses, setStatuses] = useState<PaintStatus[]>(['owned', 'in_use']);
  const [filter, setFilter] = useState<PaintFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<Sort>('added');
  const [filterOptions, setFilterOptions] = useState<{ brand: string; series: string; series_en: string | null; gloss: string | null; paint_type: string | null }[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [defaultBoxId, setDefaultBoxId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [detailInventoryId, setDetailInventoryId] = useState<number | null>(null);
  const [actionSheet, setActionSheet] = useState<{ title?: string; message?: string; buttons: ActionSheetButton[] } | null>(null);
  const [toast, setToast] = useState('');
  const [toastAction, setToastAction] = useState<{ label: string; onPress: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeRefs = useRef(new Map<number, Swipeable>());
  const [edgeSwipeItemId, setEdgeSwipeItemId] = useState<number | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    const requested = boxId === 'all' ? 'all' : Number(boxId);
    if (requested === 'all' || Number.isInteger(requested) && requested > 0) setSelected(requested);
  }, [boxId]);

  useEffect(() => { if (!isUsedScreen) setActiveBox(selected); }, [isUsedScreen, selected]);

  useEffect(() => { setStatuses(isUsedScreen ? ['used_up'] : ['owned', 'in_use']); }, [isUsedScreen]);

  useEffect(() => {
    if (isUsedScreen) return;
    if (selected === 'all') {
      const title = getLocale() === 'ja' ? 'すべてのボックス' : 'All Boxes';
      navigation.setOptions({ title });
      router.setParams({ boxName: title });
      return;
    }
    getDB().getFirstAsync<{ name: string }>('SELECT name FROM boxes WHERE id = ?', [selected]).then((box) => {
      if (box) { navigation.setOptions({ title: box.name }); router.setParams({ boxName: box.name }); }
    });
  }, [isUsedScreen, navigation, selected]);

  const load = useCallback(async (sel: Selected, sf: PaintStatus[], f: PaintFilter, sortBy: Sort) => {
    const db = getDB();
    const totalWhere = sel === 'all' ? '' : ' AND box_id = ?';
    const totalArgs = sel === 'all' ? [] : [sel];
    const [defaultBox, totalRow] = await Promise.all([
      getDefaultBoxId(),
      db.getFirstAsync<CountRow>("SELECT COUNT(*) AS n FROM inventory WHERE status IN ('owned','in_use')" + totalWhere, totalArgs),
    ]);
    setDefaultBoxId(defaultBox);
    setInventoryTotal(totalRow?.n ?? 0);
    // 絞り込み候補(所有塗料の brand/series)
    setFilterOptions(await db.getAllAsync<{ brand: string; series: string; series_en: string | null; gloss: string | null; paint_type: string | null }>(
      'SELECT DISTINCT c.brand, c.series, c.series_en, c.gloss, c.paint_type FROM inventory i'
      + ' JOIN catalog_paints c ON i.paint_id = c.id'
    ));

    const where: string[] = [];
    const args: (number | string)[] = [];

    if (sf.length === 0) {
      where.push('1 = 0'); // 全OFFなら該当なし
    } else {
      where.push(`i.status IN (${sf.map(() => '?').join(',')})`);
      args.push(...sf);
    }

    // 使用済はボックスに属さない共通履歴として常に横断表示する。
    if (sel !== 'all' && !sf.includes('used_up')) { where.push('i.box_id = ?'); args.push(sel); }

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

    const sql =
      'SELECT i.id, i.paint_id, c.name_ja, c.name_en, c.code, c.brand, c.hex, c.gloss, c.paint_type, i.status, i.box_id'
      + ' FROM inventory i JOIN catalog_paints c ON i.paint_id = c.id'
      + ' WHERE ' + where.join(' AND ')
      + ' ORDER BY ' + SORT_ORDER[sortBy];
    setItems(await db.getAllAsync<InventoryItem>(sql, args));
  }, []);

  useFocusEffect(useCallback(() => {
    // 初回オープン時は「一覧」ではなくデフォルトのボックスを初期表示にする。
    if (!initializedRef.current) {
      initializedRef.current = true;
      getDefaultBoxId().then((id) => {
        const initial: Selected = id ?? 'all';
        setSelected(initial);
        load(initial, statuses, filter, sort);
      });
      return;
    }
    load(selected, statuses, filter, sort);
  }, [load, selected, statuses, filter, sort]));

  const reload = () => load(selected, statuses, filter, sort);
  const toggleStatus = (s: PaintStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    setStatuses(next);
    load(selected, next, filter, sort);
  };
  const filterActive = filter.brands.length > 0 || filter.series.length > 0 || filter.gloss.length > 0 || filter.types.length > 0 || filter.search.trim() !== '';
  const statusDefault = statuses.length === 2 && statuses.includes('owned') && statuses.includes('in_use');
  const trulyEmpty = isUsedScreen ? items.length === 0 : !filterActive && statusDefault && inventoryTotal === 0;
  const emptyMessage = trulyEmpty ? t('emptyOwned') : t('noResults');
  const statusLabel = statusDefault ? 'すべてのステータス' : statuses.length === 1 ? t(statuses[0] === 'owned' ? 'statusOwned' : 'statusInUse') : t('statusAll');
  const statusColor = statusDefault ? '#2e7d32' : statuses[0] === 'owned' ? colors.primary : colors.inUse;

  const showToast = (message: string, actionLabel?: string, onAction?: () => void) => {
    setToast(message);
    setToastAction(actionLabel && onAction ? { label: actionLabel, onPress: onAction } : null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => { setToast(''); setToastAction(null); }, actionLabel ? 3000 : 1800);
  };

  // --- 塗料の状態/削除 ---
  const setStatus = async (item: InventoryItem, next: PaintStatus) => {
    await setInventoryStatus(item.id, next);
    reload();
  };
  // 削除確認と同じネイティブAlertを使う。ActionSheetだとスワイプ残像やトーストが
  // 半透明背景越しに透けて見える問題があった(ネイティブAlertはOSが別レイヤーで描画する)。
  const promptAddToWishlist = (item: InventoryItem) => {
    Alert.alert(t('addToWishlistPrompt'), '', [
      {
        text: t('cancel'), style: 'cancel',
      },
      { text: t('dontAddToList'), onPress: async () => { await setStatus(item, 'used_up'); showToast(paintName(item.name_ja, item.name_en) + t('usedUpToast')); } },
      {
        text: t('add'),
        onPress: async () => {
          const membership = await getListMembership(item.paint_id);
          if (!membership.wishlist) {
            await getDB().runAsync("INSERT INTO lists (type, paint_id) VALUES ('wishlist', ?)", [item.paint_id]);
          }
          await setStatus(item, 'used_up');
          showToast(paintName(item.name_ja, item.name_en) + t('usedUpToast'));
        },
      },
    ]);
  };
  const toggleStockUse = (item: InventoryItem) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (item.status === 'used_up') { setStatus(item, 'owned'); return; }
    setStatus(item, item.status === 'in_use' ? 'owned' : 'in_use');
  };
  const markUsedUp = async (item: InventoryItem) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    swipeRefs.current.get(item.id)?.close();
    promptAddToWishlist(item);
  };
  const deleteItem = async (item: InventoryItem) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    swipeRefs.current.get(item.id)?.close();
    Alert.alert(t('deleteInventoryConfirm'), '', [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'), style: 'destructive',
        onPress: async () => {
          const db = getDB();
          await db.runAsync('DELETE FROM inventory WHERE id = ?', [item.id]);
          reload();
          showToast(paintName(item.name_ja, item.name_en) + t('removedToast'));
        },
      },
    ]);
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

  const renderRightActions = () => (
    <View style={styles.deleteAction}>
      <Text style={styles.deleteActionText}>{t('delete')}</Text>
    </View>
  );

  // 左→右スワイプで使用済(再操作で在庫へ戻す)。スワイプが完全に開いた時点で確定する(onSwipeableOpenで発火)。
  const renderLeftActions = () => (
    <View style={styles.usedAction}>
      <Text style={styles.usedActionText}>{t('statusUsedUp')}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.edgeGestureZone} pointerEvents="box-only" />
      {/* 総数と状態フィルタ */}
      <View style={styles.statusBarWrap}>
        <Text style={styles.statusCount}>{`塗料総数 ${isUsedScreen ? items.length : inventoryTotal} ・ 表示数 ${items.length}`}</Text>
        {!isUsedScreen ? <TouchableOpacity style={styles.statusSelect} onPress={() => setShowStatusPicker(true)} accessibilityRole="button" accessibilityLabel={statusLabel}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.statusSelectText}>{statusLabel}</Text><IconChevronDown color={colors.textMuted} size={18} />
        </TouchableOpacity> : null}
      </View>

      <View style={styles.adBar}><AdBanner /></View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingBottom: 16 }}
        renderItem={({ item }) => (
          <View onTouchStart={(event) => { if (event.nativeEvent.locationX <= 32) setEdgeSwipeItemId(item.id); }} onTouchEnd={() => setEdgeSwipeItemId(null)} onTouchCancel={() => setEdgeSwipeItemId(null)}>
            <Swipeable
              enabled={edgeSwipeItemId !== item.id}
              ref={(r) => { if (r) swipeRefs.current.set(item.id, r); else swipeRefs.current.delete(item.id); }}
              renderRightActions={renderRightActions}
              renderLeftActions={item.status === 'used_up' ? undefined : renderLeftActions}
              onSwipeableOpen={(direction) => {
                if (direction === 'right') deleteItem(item);
                else markUsedUp(item);
              }}
              overshootRight={false}
              overshootLeft={false}
            >
              <TouchableOpacity onPress={() => setDetailInventoryId(item.id)}>
                <PaintRow paint={item}>
                  {/* 在庫⇄使用中 トグル (使用済の時は非活性) */}
                  <TouchableOpacity
                    style={[styles.iconBtn, {
                      backgroundColor: item.status === 'used_up'
                        ? colors.usedUp
                        : (item.status === 'in_use' ? colors.inUse : colors.primary),
                    }]}
                    onPress={() => toggleStockUse(item)}
                  >
                    <Text style={styles.iconBtnText}>
                      {item.status === 'used_up' ? t('statusUsedUp') : (item.status === 'in_use' ? t('statusInUse') : t('statusOwned'))}
                    </Text>
                  </TouchableOpacity>
                </PaintRow>
              </TouchableOpacity>
            </Swipeable>
          </View>
        )}
        ListEmptyComponent={(
          <EmptyState
            icon={IconBox}
            title={emptyMessage}
            actionLabel={trulyEmpty ? t('addPaint') : undefined}
            onAction={trulyEmpty ? () => setShowAdd(true) : undefined}
          />
        )}
      />

      <ListActionBar onFilter={() => setShowFilter(true)} onSort={openSort} onAdd={() => setShowAdd(true)} filterActive={filterActive} />

      <Modal visible={showStatusPicker} transparent animationType="fade" onRequestClose={() => setShowStatusPicker(false)}>
        <View style={styles.statusModalRoot}>
          <Pressable style={styles.statusModalBackdrop} onPress={() => setShowStatusPicker(false)} />
          <View style={styles.statusModal}>
            {STATUS_TOGGLES.map((option) => {
              const selectedOption = statuses.includes(option.key);
              const optionColor = option.key === 'owned' ? colors.primary : colors.inUse;
              return <TouchableOpacity key={option.key} style={styles.statusOption} onPress={() => toggleStatus(option.key)}>
                <View style={[styles.statusDot, { backgroundColor: optionColor }]} /><Text style={styles.statusOptionText}>{t(option.label)}</Text>
                <Text style={[styles.statusCheck, selectedOption && { color: optionColor }]}>{selectedOption ? '✓' : ''}</Text>
              </TouchableOpacity>;
            })}
            <TouchableOpacity style={styles.statusDone} onPress={() => setShowStatusPicker(false)}><Text style={styles.statusDoneText}>{t('ok')}</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

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
        defaultStatus="owned"
        boxId={selected === 'all' ? defaultBoxId : selected}
      />

      <InventoryDetailModal
        visible={detailInventoryId != null}
        inventoryId={detailInventoryId}
        onClose={() => setDetailInventoryId(null)}
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
  edgeGestureZone: { position: 'absolute', zIndex: 10, top: 0, bottom: 0, left: 0, width: 32 },
  adBar: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  statusBarWrap: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.borderLight, backgroundColor: colors.surfaceAlt },
  statusCount: { color: colors.text, fontSize: 15, fontVariant: ['tabular-nums'] },
  statusSelect: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusSelectText: { color: colors.text, fontSize: 14 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.xs },
  statusModalRoot: { flex: 1, justifyContent: 'center', padding: spacing.xxl },
  statusModalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.32)' },
  statusModal: { backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' },
  statusOption: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl },
  statusOptionText: { color: colors.text, fontSize: 16 },
  statusCheck: { marginLeft: 'auto', fontSize: 20, fontWeight: '700' },
  statusDone: { minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight },
  statusDoneText: { color: colors.primary, fontWeight: '700' },
  iconBtn: { width: 64, borderRadius: 12, marginLeft: spacing.sm, minHeight: touch.min, alignItems: 'center', justifyContent: 'center' },
  iconBtnText: { color: colors.onPrimary, fontSize: 12, fontWeight: 'bold' },
  deleteAction: { backgroundColor: colors.danger, justifyContent: 'center', alignItems: 'center', width: 88 },
  deleteActionText: { color: colors.onPrimary, fontWeight: 'bold' },
  usedAction: { backgroundColor: colors.darkAction, justifyContent: 'center', alignItems: 'center', width: 88 },
  usedActionText: { color: colors.onPrimary, fontWeight: 'bold' },
});
