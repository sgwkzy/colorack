// app/(tabs)/owned.tsx
import { useCallback, useRef, useState, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ScrollView, StyleSheet, Alert,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { IconSearch, IconArrowsSort, IconPlus } from '@tabler/icons-react-native';
import { useFocusEffect } from 'expo-router';
import { getDB, getDefaultBoxId, getListMembership, PaintStatus, setInventoryStatus } from '../../lib/db';
import { t } from '../../lib/i18n';
import { paintName } from '../../lib/paintLabel';
import { useTheme, lightColors, radius, spacing, touch } from '../../lib/theme';
import { useUiPrefs, type FabSide } from '../../lib/uiPrefs';
import AddPaintModal from '../../components/AddPaint';
import AdBanner from '../../components/AdBanner';
import FilterModal, { PaintFilter } from '../../components/FilterModal';
import InventoryDetailModal from '../../components/InventoryDetailModal';
import PaintRow from '../../components/PaintRow';
import TextPromptModal from '../../components/TextPromptModal';
import Toast from '../../components/Toast';

interface Box { id: number; name: string; }
interface CountRow { n: number; }
interface BoxCountRow { box_id: number | null; n: number; }
interface StatusCountRow { status: PaintStatus; n: number; }

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

// 状態フィルタ(2段目): 在庫/使用中/使用済を独立ON/OFF
const STATUS_TOGGLES: { key: PaintStatus; label: string }[] = [
  { key: 'owned', label: 'statusOwned' },
  { key: 'in_use', label: 'statusInUse' },
  { key: 'used_up', label: 'statusUsedUp' },
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
  const { fabSide } = useUiPrefs();
  const styles = useMemo(() => makeStyles(colors, fabSide), [colors, fabSide]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [boxCounts, setBoxCounts] = useState<Map<number | null, number>>(new Map());
  const [statusCounts, setStatusCounts] = useState<Map<PaintStatus, number>>(new Map());
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
  const [detailInventoryId, setDetailInventoryId] = useState<number | null>(null);
  const [boxPrompt, setBoxPrompt] = useState<{ title: string; initialValue?: string; onSubmit: (text: string) => void } | null>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeRefs = useRef(new Map<number, Swipeable>());
  const initializedRef = useRef(false);

  const load = useCallback(async (sel: Selected, sf: PaintStatus[], f: PaintFilter, sortBy: Sort) => {
    const db = getDB();
    // 状態トグル(在庫/使用中/使用済)の件数は、選択中のボックスに絞った数を表示する(「一覧」選択時は全ボックス合計)。
    const statusWhere = sel === 'all' ? '' : ' WHERE box_id = ?';
    const statusArgs = sel === 'all' ? [] : [sel];
    const [boxRows, defaultBox, boxCountRows, statusCountRows, totalRow] = await Promise.all([
      db.getAllAsync<Box>('SELECT id, name FROM boxes ORDER BY id'),
      getDefaultBoxId(),
      // ボックスの件数は使用済を除く(在庫+使用中)の合計。使用済は「使い切った」ものとして数えない。
      db.getAllAsync<BoxCountRow>("SELECT box_id, COUNT(*) AS n FROM inventory WHERE status IN ('owned','in_use') GROUP BY box_id"),
      db.getAllAsync<StatusCountRow>(`SELECT status, COUNT(*) AS n FROM inventory${statusWhere} GROUP BY status`, statusArgs),
      db.getFirstAsync<CountRow>("SELECT COUNT(*) AS n FROM inventory WHERE status IN ('owned','in_use')"),
    ]);
    setBoxes(boxRows);
    setDefaultBoxId(defaultBox);
    setBoxCounts(new Map(boxCountRows.map((r) => [r.box_id, r.n])));
    setStatusCounts(new Map(statusCountRows.map((r) => [r.status, r.n])));
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

    if (sel !== 'all') { where.push('i.box_id = ?'); args.push(sel); }

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
  const selectBox = (sel: Selected) => { setSelected(sel); load(sel, statuses, filter, sort); };
  const toggleStatus = (s: PaintStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    setStatuses(next);
    load(selected, next, filter, sort);
  };
  const filterActive = filter.brands.length > 0 || filter.series.length > 0 || filter.gloss.length > 0 || filter.types.length > 0 || filter.search.trim() !== '';
  const statusDefault = statuses.length === 2 && statuses.includes('owned') && statuses.includes('in_use');
  const emptyMessage = !filterActive && statusDefault && inventoryTotal === 0 ? t('emptyOwned') : t('noResults');

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1800);
  };

  // --- ボックス操作 ---
  const addBox = () => {
    setBoxPrompt({
      title: t('addBox'),
      onSubmit: async (name) => {
        const db = getDB();
        const res = await db.runAsync('INSERT INTO boxes (name) VALUES (?)', [name]);
        selectBox(res.lastInsertRowId);
      },
    });
  };
  const renameBox = (box: Box) => {
    setBoxPrompt({
      title: t('rename'),
      initialValue: box.name,
      onSubmit: async (name) => {
        const db = getDB();
        await db.runAsync('UPDATE boxes SET name = ? WHERE id = ?', [name, box.id]);
        reload();
      },
    });
  };
  const deleteBox = (box: Box) => {
    Alert.alert(box.name, t('deleteBoxConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'), style: 'destructive',
        onPress: async () => {
          const db = getDB();
          await db.runAsync('UPDATE inventory SET box_id = NULL WHERE box_id = ?', [box.id]);
          await db.runAsync('DELETE FROM boxes WHERE id = ?', [box.id]);
          selectBox('all');
        },
      },
    ]);
  };
  const onBoxLongPress = (box: Box) => {
    Alert.alert(box.name, '', [
      { text: t('rename'), onPress: () => renameBox(box) },
      { text: t('delete'), style: 'destructive', onPress: () => deleteBox(box) },
      { text: t('cancel'), style: 'cancel' },
    ]);
  };

  // --- 塗料の状態/削除 ---
  const setStatus = async (item: InventoryItem, next: PaintStatus) => {
    await setInventoryStatus(item.id, next);
    reload();
  };
  const promptAddToWishlist = (item: InventoryItem) => {
    Alert.alert(t('addToWishlistPrompt'), '', [
      { text: t('dontAddToList'), style: 'cancel' },
      {
        text: t('add'),
        onPress: async () => {
          const membership = await getListMembership(item.paint_id);
          if (!membership.wishlist) {
            await getDB().runAsync("INSERT INTO lists (type, paint_id) VALUES ('wishlist', ?)", [item.paint_id]);
          }
          showToast(paintName(item.name_ja, item.name_en) + t('addedToast'));
        },
      },
    ]);
  };
  const toggleStockUse = (item: InventoryItem) => {
    if (item.status === 'used_up') { setStatus(item, 'owned'); return; }
    setStatus(item, item.status === 'in_use' ? 'owned' : 'in_use');
  };
  const markUsedUp = async (item: InventoryItem) => {
    swipeRefs.current.get(item.id)?.close();
    await setStatus(item, 'used_up');
    showToast(paintName(item.name_ja, item.name_en) + t('usedUpToast'));
    promptAddToWishlist(item);
  };
  const deleteItem = async (item: InventoryItem) => {
    swipeRefs.current.get(item.id)?.close();
    Alert.alert(paintName(item.name_ja, item.name_en), t('deleteInventoryConfirm'), [
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
    Alert.alert(t('sort'), '', [
      ...opts.map((o) => ({ text: `${sort === o.key ? '✓ ' : ''}${o.label}`, onPress: () => setSort(o.key) })),
      { text: t('cancel'), style: 'cancel' as const },
    ]);
  };

  const countLabel = (label: string, count: number) => `${label} (${count})`;

  const boxTab = (key: string, label: string, sel: Selected, onLong?: () => void) => (
    <TouchableOpacity
      key={key}
      style={[styles.tab, selected === sel && styles.tabActive]}
      onPress={() => selectBox(sel)}
      onLongPress={onLong}
    >
      <Text style={[styles.tabText, selected === sel && styles.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

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
      {/* 上段: ボックスタブ */}
      <View style={styles.tabBarWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBar}>
          {boxTab('all', countLabel(t('allBoxes'), inventoryTotal), 'all')}
          {boxes.map((b) => boxTab(`box-${b.id}`, countLabel(b.name, boxCounts.get(b.id) ?? 0), b.id, () => onBoxLongPress(b)))}
          <TouchableOpacity style={styles.addTab} onPress={addBox}>
            <IconPlus size={16} color={colors.primary} />
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* 下段: 状態フィルタ(在庫/使用中/使用済 の独立ON/OFF) */}
      <View style={styles.statusBarWrap}>
        {STATUS_TOGGLES.map((f) => {
          const on = statuses.includes(f.key);
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.statusTab, on && styles.statusTabActive]}
              onPress={() => toggleStatus(f.key)}
            >
              <Text style={[styles.statusTabText, on && styles.statusTabTextActive]}>
                {countLabel(t(f.label), statusCounts.get(f.key) ?? 0)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingBottom: 232 }}
        renderItem={({ item }) => (
          <Swipeable
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
        )}
        ListEmptyComponent={<Text style={styles.empty}>{emptyMessage}</Text>}
        ListFooterComponent={<AdBanner />}
      />

      {/* 右下: フィルター / 並び替え / 追加 を縦に */}
      <View style={styles.fabContainer}>
        <TouchableOpacity style={[styles.fab, styles.filterFab, filterActive && styles.filterFabActive]} onPress={() => setShowFilter(true)}>
          <IconSearch color={colors.onPrimary} size={26} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.fab, styles.sortFab]} onPress={openSort}>
          <IconArrowsSort color={colors.onPrimary} size={24} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.fab, styles.addFab]} onPress={() => setShowAdd(true)}>
          <IconPlus color={colors.onPrimary} size={28} />
        </TouchableOpacity>
      </View>

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
      <TextPromptModal
        visible={boxPrompt != null}
        title={boxPrompt?.title ?? ''}
        initialValue={boxPrompt?.initialValue}
        onSubmit={(text) => boxPrompt?.onSubmit(text)}
        onClose={() => setBoxPrompt(null)}
      />
      <Toast message={toast} />
    </View>
  );
}

const makeStyles = (colors: typeof lightColors, fabSide: FabSide) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  tabBarWrap: { borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  tabBar: { alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  tab: { paddingHorizontal: 14, paddingVertical: spacing.md, marginRight: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.chip },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 14, color: colors.textSecondary },
  tabTextActive: { color: colors.onPrimary, fontWeight: 'bold' },
  addTab: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.chipAlt, alignItems: 'center', justifyContent: 'center' },
  statusBarWrap: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  statusTab: { flex: 1, minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  statusTabActive: { backgroundColor: colors.primarySoft },
  statusTabText: { fontSize: 12, color: colors.textFaint },
  statusTabTextActive: { color: colors.primary, fontWeight: 'bold' },
  iconBtn: { width: 64, borderRadius: 12, marginLeft: spacing.sm, minHeight: touch.min, alignItems: 'center', justifyContent: 'center' },
  iconBtnText: { color: colors.onPrimary, fontSize: 12, fontWeight: 'bold' },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textPlaceholder },
  deleteAction: { backgroundColor: colors.danger, justifyContent: 'center', alignItems: 'center', width: 88 },
  deleteActionText: { color: colors.onPrimary, fontWeight: 'bold' },
  usedAction: { backgroundColor: colors.darkAction, justifyContent: 'center', alignItems: 'center', width: 88 },
  usedActionText: { color: colors.onPrimary, fontWeight: 'bold' },
  fabContainer: fabSide === 'bottom' ? {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.xxl,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  } : {},
  fab: {
    ...(fabSide === 'bottom' ? {} : {
      position: 'absolute',
      ...(fabSide === 'left' ? { left: spacing.xxl } : { right: spacing.xxl }),
    }),
    width: 56, height: 56, borderRadius: radius.fab,
    alignItems: 'center', justifyContent: 'center',
  },
  addFab: fabSide === 'bottom' ? { backgroundColor: colors.primary } : { bottom: spacing.xxl, backgroundColor: colors.primary },
  sortFab: fabSide === 'bottom' ? { backgroundColor: colors.neutralAction } : { bottom: 92, backgroundColor: colors.neutralAction },
  filterFab: fabSide === 'bottom' ? { backgroundColor: colors.neutralAction } : { bottom: 160, backgroundColor: colors.neutralAction },
  filterFabActive: { backgroundColor: colors.primary },
});
