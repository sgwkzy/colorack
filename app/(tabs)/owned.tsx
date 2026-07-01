// app/(tabs)/owned.tsx
import { useCallback, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ScrollView, StyleSheet, Alert,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { IconSearch, IconArrowsSort, IconPlus } from '@tabler/icons-react-native';
import { useFocusEffect } from 'expo-router';
import { getDB, getDefaultBoxId, PaintStatus } from '../../lib/db';
import { t } from '../../lib/i18n';
import { brandLabel } from '../../lib/brands';
import { glossLabel } from '../../lib/gloss';
import { paintName } from '../../lib/paintLabel';
import AddPaintModal from '../../components/AddPaint';
import AdBanner from '../../components/AdBanner';
import FilterModal, { PaintFilter } from '../../components/FilterModal';
import TypeIcon from '../../components/TypeIcon';

interface Box { id: number; name: string; }

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

type Sort = 'added' | 'name' | 'brand';
const SORT_ORDER: Record<Sort, string> = {
  added: 'i.added_at DESC',
  name: 'c.name_ja COLLATE NOCASE ASC',
  brand: 'c.brand ASC, c.name_ja ASC',
};

export default function OwnedScreen() {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selected, setSelected] = useState<Selected>('all');
  const [statuses, setStatuses] = useState<PaintStatus[]>(['owned', 'in_use']);
  const [filter, setFilter] = useState<PaintFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<Sort>('added');
  const [filterOptions, setFilterOptions] = useState<{ brand: string; series: string; series_en: string | null; gloss: string | null; paint_type: string | null }[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [defaultBoxId, setDefaultBoxId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const swipeRefs = useRef(new Map<number, Swipeable>());
  const initializedRef = useRef(false);

  const load = useCallback(async (sel: Selected, sf: PaintStatus[], f: PaintFilter, sortBy: Sort) => {
    const db = getDB();
    setBoxes(await db.getAllAsync<Box>('SELECT id, name FROM boxes ORDER BY id'));
    setDefaultBoxId(await getDefaultBoxId());
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

  // --- ボックス操作 ---
  const addBox = () => {
    Alert.prompt(t('addBox'), t('boxName'), async (name) => {
      if (!name || !name.trim()) return;
      const db = getDB();
      const res = await db.runAsync('INSERT INTO boxes (name) VALUES (?)', [name.trim()]);
      selectBox(res.lastInsertRowId);
    });
  };
  const renameBox = (box: Box) => {
    Alert.prompt(t('rename'), t('boxName'), async (name) => {
      if (!name || !name.trim()) return;
      const db = getDB();
      await db.runAsync('UPDATE boxes SET name = ? WHERE id = ?', [name.trim(), box.id]);
      reload();
    }, undefined, box.name);
  };
  const deleteBox = (box: Box) => {
    Alert.alert(box.name, t('delete'), [
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
    const db = getDB();
    await db.runAsync('UPDATE inventory SET status = ? WHERE id = ?', [next, item.id]);
    reload();
  };
  const toggleStockUse = (item: InventoryItem) => {
    if (item.status === 'used_up') { setStatus(item, 'owned'); return; }
    setStatus(item, item.status === 'in_use' ? 'owned' : 'in_use');
  };
  const markUsedUp = (item: InventoryItem) => {
    swipeRefs.current.get(item.id)?.close();
    setStatus(item, 'used_up');
  };
  const deleteItem = async (item: InventoryItem) => {
    const db = getDB();
    await db.runAsync('DELETE FROM inventory WHERE id = ?', [item.id]);
    reload();
  };

  const openSort = () => {
    const opts: { key: Sort; label: string }[] = [
      { key: 'added', label: t('sortAdded') },
      { key: 'name', label: t('sortName') },
      { key: 'brand', label: t('sortBrand') },
    ];
    Alert.alert(t('sort'), '', [
      ...opts.map((o) => ({ text: o.label, onPress: () => setSort(o.key) })),
      { text: t('cancel'), style: 'cancel' as const },
    ]);
  };

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

  const renderRightActions = (item: InventoryItem) => (
    <TouchableOpacity style={styles.deleteAction} onPress={() => deleteItem(item)}>
      <Text style={styles.deleteActionText}>{t('delete')}</Text>
    </TouchableOpacity>
  );

  // 左→右スワイプで使用済(再操作で在庫へ戻す)
  const renderLeftActions = (item: InventoryItem) => (
    <TouchableOpacity style={styles.usedAction} onPress={() => markUsedUp(item)}>
      <Text style={styles.usedActionText}>{t('statusUsedUp')}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* 上段: ボックスタブ */}
      <View style={styles.tabBarWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBar}>
          {boxTab('all', t('allBoxes'), 'all')}
          {boxes.map((b) => boxTab(`box-${b.id}`, b.name, b.id, () => onBoxLongPress(b)))}
          <TouchableOpacity style={styles.addTab} onPress={addBox}>
            <Text style={styles.addTabText}>＋</Text>
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
                {t(f.label)}
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
            enabled={item.status !== 'used_up'}
            renderRightActions={() => renderRightActions(item)}
            renderLeftActions={() => renderLeftActions(item)}
            overshootRight={false}
            overshootLeft={false}
          >
            <View style={[styles.row, { borderLeftColor: item.hex, borderLeftWidth: 8 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {paintName(item.name_ja, item.name_en)}{item.code ? <Text style={styles.code}>  {item.code}</Text> : null}
                </Text>
                <View style={styles.subRow}>
                  <TypeIcon paintType={item.paint_type} />
                  <Text style={styles.sub}>{brandLabel(item.brand)}{item.gloss ? ` · ${glossLabel(item.gloss)}` : ''}</Text>
                </View>
              </View>
              {/* 在庫⇄使用中 トグル (使用済の時は非活性) */}
              <TouchableOpacity
                style={[styles.iconBtn, {
                  backgroundColor: item.status === 'used_up'
                    ? '#95a5a6'
                    : (item.status === 'in_use' ? '#e67e22' : '#4a90d9'),
                }]}
                onPress={() => toggleStockUse(item)}
              >
                <Text style={styles.iconBtnText}>
                  {item.status === 'used_up' ? t('statusUsedUp') : (item.status === 'in_use' ? t('statusInUse') : t('statusOwned'))}
                </Text>
              </TouchableOpacity>
            </View>
          </Swipeable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{t('noResults')}</Text>}
        ListFooterComponent={<AdBanner />}
      />

      {/* 右下: フィルター / 並び替え / 追加 を縦に */}
      <TouchableOpacity style={[styles.fab, styles.filterFab, filterActive && styles.filterFabActive]} onPress={() => setShowFilter(true)}>
        <IconSearch color="#fff" size={26} />
      </TouchableOpacity>
      <TouchableOpacity style={[styles.fab, styles.sortFab]} onPress={openSort}>
        <IconArrowsSort color="#fff" size={24} />
      </TouchableOpacity>
      <TouchableOpacity style={[styles.fab, styles.addFab]} onPress={() => setShowAdd(true)}>
        <IconPlus color="#fff" size={28} />
      </TouchableOpacity>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabBarWrap: { borderBottomWidth: 1, borderBottomColor: '#eee' },
  tabBar: { alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, marginRight: 6, borderRadius: 16, backgroundColor: '#f0f0f0' },
  tabActive: { backgroundColor: '#4a90d9' },
  tabText: { fontSize: 14, color: '#555' },
  tabTextActive: { color: '#fff', fontWeight: 'bold' },
  addTab: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: '#e8e8e8' },
  addTabText: { fontSize: 14, color: '#4a90d9', fontWeight: 'bold' },
  statusBarWrap: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#eee' },
  statusTab: { flex: 1, paddingVertical: 6, alignItems: 'center', borderRadius: 8 },
  statusTabActive: { backgroundColor: '#eef4fb' },
  statusTabText: { fontSize: 12, color: '#888' },
  statusTabTextActive: { color: '#4a90d9', fontWeight: 'bold' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  name: { fontSize: 16 },
  code: { fontSize: 12, color: '#999', fontWeight: 'normal' },
  subRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  sub: { fontSize: 12, color: '#666' },
  iconBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, marginLeft: 6 },
  iconBtnText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  empty: { textAlign: 'center', marginTop: 40, color: '#999' },
  deleteAction: { backgroundColor: '#e74c3c', justifyContent: 'center', alignItems: 'center', width: 88 },
  deleteActionText: { color: '#fff', fontWeight: 'bold' },
  usedAction: { backgroundColor: '#34495e', justifyContent: 'center', alignItems: 'center', width: 88 },
  usedActionText: { color: '#fff', fontWeight: 'bold' },
  fab: {
    position: 'absolute', right: 24,
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
  },
  addFab: { bottom: 24, backgroundColor: '#4a90d9' },
  sortFab: { bottom: 92, backgroundColor: '#7f8c8d' },
  filterFab: { bottom: 160, backgroundColor: '#7f8c8d' },
  filterFabActive: { backgroundColor: '#4a90d9' },
});
