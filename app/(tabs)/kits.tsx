// app/(tabs)/kits.tsx
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconBox, IconChevronDown } from '@tabler/icons-react-native';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { getDB, getDefaultKitBoxId, KitStatus } from '../../lib/db';
import { setActiveKitBox } from '../../lib/activeKitBox';
import { setAppMode } from '../../lib/appMode';
import { t, useLocale } from '../../lib/i18n';
import { setLastScreen } from '../../lib/lastScreen';
import { lightColors, radius, spacing, touch, useTheme } from '../../lib/theme';
import ActionSheet, { ActionSheetButton } from '../../components/ActionSheet';
import AddKitModal from '../../components/AddKitModal';
import AdBanner from '../../components/AdBanner';
import EmptyState from '../../components/EmptyState';
import KitDetailModal from '../../components/KitDetailModal';
import KitFilterModal, { KitFilter } from '../../components/KitFilterModal';
import ListActionBar from '../../components/ListActionBar';

interface CountRow { n: number; }

interface KitListItem {
  id: number;
  name: string;
  maker: string;
  scale: string | null;
  thumb_uri: string | null;
  status: KitStatus;
}

type Selected = 'all' | number;

// completed は専用画面(完成品)でのみ扱う。塗料の保管箱一覧が used_up を
// STATUS_TOGGLES に含めないのと同じ考え方。
const STATUS_TOGGLES: { key: KitStatus; label: string }[] = [
  { key: 'not_started', label: 'statusNotStarted' },
  { key: 'building', label: 'statusBuilding' },
];

const STATUS_LABEL_KEYS: Record<KitStatus, string> = {
  not_started: 'statusNotStarted',
  building: 'statusBuilding',
  completed: 'statusCompleted',
};

const EMPTY_KIT_FILTER: KitFilter = { makers: [], series: [], categories: [], scales: [], search: '' };

type KitSort = 'added' | 'name' | 'maker';
const KIT_SORT_ORDER: Record<KitSort, string> = {
  added: 'added_at DESC',
  name: 'name COLLATE NOCASE ASC',
  maker: 'maker ASC, name ASC',
};

export function KitsScreen({ completedScreen = false }: { completedScreen?: boolean }) {
  const locale = useLocale();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const navigation = useNavigation();
  const { boxId } = useLocalSearchParams<{ boxId?: string }>();
  const [kitTotal, setKitTotal] = useState(0);
  const [selected, setSelected] = useState<Selected>('all');
  const [statuses, setStatuses] = useState<KitStatus[]>(completedScreen ? ['completed'] : ['not_started', 'building']);
  const [filter, setFilter] = useState<KitFilter>(EMPTY_KIT_FILTER);
  const [sort, setSort] = useState<KitSort>('added');
  const [filterOptions, setFilterOptions] = useState<{ maker: string; series: string | null; category: string | null; scale: string | null }[]>([]);
  const [items, setItems] = useState<KitListItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [detailKitId, setDetailKitId] = useState<number | null>(null);
  const [defaultBoxId, setDefaultBoxId] = useState<number | null>(null);
  const [actionSheet, setActionSheet] = useState<{ title?: string; message?: string; buttons: ActionSheetButton[] } | null>(null);

  useEffect(() => {
    if (completedScreen) return;
    const requested = boxId === 'all' ? 'all' : Number(boxId);
    if (requested === 'all' || (Number.isInteger(requested) && requested > 0)) setSelected(requested);
  }, [boxId, completedScreen]);

  useEffect(() => { if (!completedScreen) setActiveKitBox(selected); }, [completedScreen, selected]);

  // 実際にこの画面が表示された時点で、起動時復元先とドロワーのモードを常に一致させる。
  useFocusEffect(useCallback(() => {
    setLastScreen(completedScreen ? 'completed' : 'kits');
    setAppMode('kitrack');
  }, [completedScreen]));

  useEffect(() => {
    if (completedScreen) {
      navigation.setOptions({ title: t('completedKits') });
      return;
    }
    if (selected === 'all') {
      const title = locale === 'ja' ? 'すべてのボックス' : 'All Boxes';
      navigation.setOptions({ title });
      router.setParams({ boxName: title });
      return;
    }
    getDB().getFirstAsync<{ name: string }>('SELECT name FROM kit_boxes WHERE id = ?', [selected]).then((box) => {
      if (box) { navigation.setOptions({ title: box.name }); router.setParams({ boxName: box.name }); }
    });
  }, [completedScreen, locale, navigation, selected]);

  useEffect(() => { getDefaultKitBoxId().then(setDefaultBoxId); }, []);

  const load = useCallback(async (sel: Selected, sf: KitStatus[], f: KitFilter, sortBy: KitSort) => {
    const db = getDB();
    const totalWhere = completedScreen || sel === 'all' ? '' : ' AND box_id = ?';
    const totalArgs = completedScreen || sel === 'all' ? [] : [sel];
    const where: string[] = [];
    const args: (string | number)[] = [];

    if (sf.length === 0) {
      where.push('1 = 0'); // 全OFFなら該当なし
    } else {
      where.push(`status IN (${sf.map(() => '?').join(',')})`);
      args.push(...sf);
    }

    if (!completedScreen && sel !== 'all') { where.push('box_id = ?'); args.push(sel); }

    if (f.makers.length) { where.push(`maker IN (${f.makers.map(() => '?').join(',')})`); args.push(...f.makers); }
    if (f.series.length) { where.push(`series IN (${f.series.map(() => '?').join(',')})`); args.push(...f.series); }
    if (f.categories.length) { where.push(`category IN (${f.categories.map(() => '?').join(',')})`); args.push(...f.categories); }
    if (f.scales.length) { where.push(`scale IN (${f.scales.map(() => '?').join(',')})`); args.push(...f.scales); }
    if (f.search.trim()) { where.push('name LIKE ?'); args.push(`%${f.search.trim()}%`); }

    const sql =
      'SELECT id, name, maker, scale, status,'
      + ' (SELECT uri FROM kit_photos WHERE kit_id = kits.id ORDER BY sort_order, id LIMIT 1) AS thumb_uri'
      + ' FROM kits WHERE ' + where.join(' AND ')
      + ' ORDER BY ' + KIT_SORT_ORDER[sortBy];

    const [totalRow, nextFilterOptions, nextItems] = await Promise.all([
      db.getFirstAsync<CountRow>("SELECT COUNT(*) AS n FROM kits WHERE status IN ('not_started','building')" + totalWhere, totalArgs),
      db.getAllAsync<{ maker: string; series: string | null; category: string | null; scale: string | null }>(
        'SELECT DISTINCT maker, series, category, scale FROM kits'
      ),
      db.getAllAsync<KitListItem>(sql, args),
    ]);
    setKitTotal(totalRow?.n ?? 0);
    setFilterOptions(nextFilterOptions);
    setItems(nextItems);
  }, [completedScreen]);

  useFocusEffect(useCallback(() => { load(selected, statuses, filter, sort); }, [load, selected, statuses, filter, sort]));

  const reload = () => load(selected, statuses, filter, sort);
  const toggleStatus = (s: KitStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    setStatuses(next);
    load(selected, next, filter, sort);
  };

  const filterActive = filter.makers.length > 0 || filter.series.length > 0 || filter.categories.length > 0 || filter.scales.length > 0 || filter.search.trim() !== '';
  const statusDefault = statuses.length === 2 && statuses.includes('not_started') && statuses.includes('building');
  const trulyEmpty = completedScreen ? items.length === 0 : !filterActive && statusDefault && kitTotal === 0;
  const emptyMessage = trulyEmpty ? t('emptyKits') : t('noResults');
  const statusLabel = statusDefault ? (locale === 'ja' ? 'すべてのステータス' : 'All statuses') : statuses.length === 1 ? t(statuses[0] === 'not_started' ? 'statusNotStarted' : 'statusBuilding') : t('statusAll');
  const statusColor = statusDefault ? '#2e7d32' : statuses[0] === 'not_started' ? colors.primary : colors.inUse;

  const openSort = () => {
    const opts: { key: KitSort; label: string }[] = [
      { key: 'added', label: t('sortAdded') },
      { key: 'name', label: t('sortName') },
      { key: 'maker', label: t('sortMaker') },
    ];
    setActionSheet({ title: t('sort'), message: '', buttons: [
      ...opts.map((o) => ({ text: `${sort === o.key ? '✓ ' : ''}${o.label}`, onPress: () => setSort(o.key) })),
      { text: t('cancel'), style: 'cancel' as const },
    ] });
  };

  return (
    <View style={styles.container}>
      <View style={styles.statusBarWrap}>
        <Text style={styles.statusCount}>{locale === 'ja'
          ? `キット数 ${completedScreen ? items.length : kitTotal} ・ 表示数 ${items.length}`
          : `Kits ${completedScreen ? items.length : kitTotal} · Showing ${items.length}`}</Text>
        {!completedScreen ? <TouchableOpacity style={styles.statusSelect} onPress={() => setShowStatusPicker(true)} accessibilityRole="button" accessibilityLabel={statusLabel}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.statusSelectText}>{statusLabel}</Text><IconChevronDown color={colors.textMuted} size={18} />
        </TouchableOpacity> : null}
      </View>

      <View style={styles.adBar}><AdBanner /></View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => setDetailKitId(item.id)}>
            {item.thumb_uri ? (
              <Image source={{ uri: item.thumb_uri }} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={styles.thumbPlaceholder}><IconBox color={colors.textFaint} size={22} /></View>
            )}
            <View style={styles.rowInfo}>
              <Text numberOfLines={1} style={styles.rowName}>{item.name}</Text>
              <Text numberOfLines={1} style={styles.rowSub}>{item.maker}{item.scale ? ` · ${item.scale}` : ''}</Text>
            </View>
            <Text style={styles.rowStatus}>{t(STATUS_LABEL_KEYS[item.status])}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={(
          <EmptyState
            icon={IconBox}
            title={emptyMessage}
            actionLabel={trulyEmpty ? t('addKit') : undefined}
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
              const optionColor = option.key === 'not_started' ? colors.primary : colors.inUse;
              return <TouchableOpacity key={option.key} style={styles.statusOption} onPress={() => toggleStatus(option.key)}>
                <View style={[styles.statusDot, { backgroundColor: optionColor }]} /><Text style={styles.statusOptionText}>{t(option.label)}</Text>
                <Text style={[styles.statusCheck, selectedOption && { color: optionColor }]}>{selectedOption ? '✓' : ''}</Text>
              </TouchableOpacity>;
            })}
            <TouchableOpacity style={styles.statusDone} onPress={() => setShowStatusPicker(false)}><Text style={styles.statusDoneText}>{t('ok')}</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <KitFilterModal
        visible={showFilter}
        options={filterOptions}
        initial={filter}
        onApply={(f) => { setFilter(f); setShowFilter(false); }}
        onClose={() => setShowFilter(false)}
      />

      <AddKitModal
        visible={showAdd}
        defaultBoxId={completedScreen || selected === 'all' ? defaultBoxId : selected}
        onClose={() => { setShowAdd(false); reload(); }}
      />
      <KitDetailModal
        visible={detailKitId != null}
        kitId={detailKitId}
        onClose={() => setDetailKitId(null)}
        onChanged={reload}
      />
      <ActionSheet
        visible={!!actionSheet}
        title={actionSheet?.title}
        message={actionSheet?.message}
        buttons={actionSheet?.buttons ?? []}
        onClose={() => setActionSheet(null)}
      />
    </View>
  );
}

export default function KitsRouteScreen() {
  return <KitsScreen />;
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
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
  list: { paddingBottom: 104 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  thumb: { width: 48, height: 48, borderRadius: radius.sm },
  thumbPlaceholder: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowStatus: { fontSize: 12, color: colors.textFaint },
});
