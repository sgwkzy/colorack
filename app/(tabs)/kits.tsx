// app/(tabs)/kits.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Image, LayoutAnimation, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { IconBox } from '@tabler/icons-react-native';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { deleteKit, getDB, getDefaultKitBoxId, getKitPhotos, KitStatus, setKitStatus } from '../../lib/db';
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
import ListActionBar, { ListToolbar } from '../../components/ListActionBar';
import { deleteKitPhoto } from '../../lib/kitPhoto';

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

export function KitsScreen({ completedScreen = false, wishlistScreen = false }: { completedScreen?: boolean; wishlistScreen?: boolean }) {
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
  const [detailKitId, setDetailKitId] = useState<number | null>(null);
  const [defaultBoxId, setDefaultBoxId] = useState<number | null>(null);
  const [actionSheet, setActionSheet] = useState<{ title?: string; message?: string; buttons: ActionSheetButton[] } | null>(null);
  const swipeRefs = useRef(new Map<number, Swipeable>());
  const loadVersionRef = useRef(0);

  useEffect(() => {
    if (completedScreen || wishlistScreen) return;
    const requested = boxId === 'all' ? 'all' : Number(boxId);
    if (requested === 'all' || (Number.isInteger(requested) && requested > 0)) setSelected(requested);
  }, [boxId, completedScreen, wishlistScreen]);

  useEffect(() => { if (!completedScreen && !wishlistScreen) setActiveKitBox(selected); }, [completedScreen, wishlistScreen, selected]);

  // 実際にこの画面が表示された時点で、起動時復元先とドロワーのモードを常に一致させる。
  useFocusEffect(useCallback(() => {
    setLastScreen(completedScreen ? 'completed' : 'kits');
    setAppMode('kitrack');
  }, [completedScreen]));

  useEffect(() => {
    let cancelled = false;
    if (completedScreen || wishlistScreen) {
      navigation.setOptions({ title: t(completedScreen ? 'completedKits' : 'kitWishlist') });
      return;
    }
    if (selected === 'all') {
      const title = t('allBoxes');
      navigation.setOptions({ title });
      router.setParams({ boxName: title });
      return;
    }
    getDB().getFirstAsync<{ name: string }>('SELECT name FROM kit_boxes WHERE id = ?', [selected]).then((box) => {
      if (!cancelled && box) { navigation.setOptions({ title: box.name }); router.setParams({ boxName: box.name }); }
    });
    return () => { cancelled = true; };
  }, [completedScreen, wishlistScreen, locale, navigation, selected]);

  useEffect(() => { getDefaultKitBoxId().then(setDefaultBoxId); }, []);

  const load = useCallback(async (sel: Selected, sf: KitStatus[], f: KitFilter, sortBy: KitSort) => {
    const loadVersion = ++loadVersionRef.current;
    const db = getDB();
    const totalWhere = completedScreen || wishlistScreen || sel === 'all' ? '' : ' AND box_id = ?';
    const totalArgs = completedScreen || wishlistScreen || sel === 'all' ? [] : [sel];
    const where: string[] = [];
    const args: (string | number)[] = [];

    if (wishlistScreen) {
      where.push('id IN (SELECT kit_id FROM kit_lists)');
    } else if (sf.length === 0) {
      where.push('1 = 0'); // 全OFFなら該当なし
    } else {
      where.push(`status IN (${sf.map(() => '?').join(',')})`);
      args.push(...sf);
    }

    if (!completedScreen && !wishlistScreen && sel !== 'all') { where.push('box_id = ?'); args.push(sel); }

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
      db.getFirstAsync<CountRow>(wishlistScreen ? 'SELECT COUNT(*) AS n FROM kit_lists' : "SELECT COUNT(*) AS n FROM kits WHERE status IN ('not_started','building')" + totalWhere, wishlistScreen ? [] : totalArgs),
      db.getAllAsync<{ maker: string; series: string | null; category: string | null; scale: string | null }>(
        wishlistScreen ? 'SELECT DISTINCT maker, series, category, scale FROM kits WHERE id IN (SELECT kit_id FROM kit_lists)' : 'SELECT DISTINCT maker, series, category, scale FROM kits'
      ),
      db.getAllAsync<KitListItem>(sql, args),
    ]);
    if (loadVersion !== loadVersionRef.current) return;
    setKitTotal(totalRow?.n ?? 0);
    setFilterOptions(nextFilterOptions);
    setItems(nextItems);
  }, [completedScreen, wishlistScreen]);

  useFocusEffect(useCallback(() => { load(selected, statuses, filter, sort); }, [load, selected, statuses, filter, sort]));

  const reload = () => load(selected, statuses, filter, sort);

  // 未着手⇄制作中 トグル(完成品画面では完成→未着手に戻す)。塗料の在庫⇄使用中トグルと同じ挙動。
  const toggleKitStatus = async (item: KitListItem) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (item.status === 'completed') { await setKitStatus(item.id, 'not_started'); reload(); return; }
    await setKitStatus(item.id, item.status === 'building' ? 'not_started' : 'building');
    reload();
  };

  const completeKit = async (item: KitListItem) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    swipeRefs.current.get(item.id)?.close();
    await setKitStatus(item.id, 'completed');
    reload();
  };

  const deleteKitItem = (item: KitListItem) => {
    swipeRefs.current.get(item.id)?.close();
    Alert.alert(item.name, t('deleteKitConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'), style: 'destructive',
        onPress: async () => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          const photos = await getKitPhotos(item.id);
          await deleteKit(item.id);
          await Promise.all(photos.map((photo) => deleteKitPhoto(photo.uri)));
          reload();
        },
      },
    ]);
  };

  const renderDeleteAction = () => <View style={styles.deleteAction}><Text style={styles.swipeActionText}>{t('delete')}</Text></View>;
  const renderCompleteAction = () => <View style={styles.completeAction}><Text style={styles.swipeActionText}>{t('statusCompleted')}</Text></View>;

  const statusDefault = completedScreen
    ? statuses.length === 1 && statuses[0] === 'completed'
    : wishlistScreen || (statuses.length === 2 && statuses.includes('not_started') && statuses.includes('building'));
  const filterActive = !statusDefault || filter.makers.length > 0 || filter.series.length > 0 || filter.categories.length > 0 || filter.scales.length > 0 || filter.search.trim() !== '';
  const trulyEmpty = completedScreen || wishlistScreen ? items.length === 0 : !filterActive && statusDefault && kitTotal === 0;
  const emptyMessage = trulyEmpty ? t('emptyKits') : t('noResults');

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
        <Text style={styles.statusCount}>{t('kitCount', { total: completedScreen || wishlistScreen ? items.length : kitTotal, shown: items.length })}</Text>
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
            renderRightActions={renderDeleteAction}
            renderLeftActions={completedScreen || wishlistScreen ? undefined : renderCompleteAction}
            onSwipeableOpen={(direction) => {
              if (direction === 'left') deleteKitItem(item);
              else completeKit(item);
            }}
            onSwipeableWillOpen={() => swipeRefs.current.forEach((swipeable, id) => { if (id !== item.id) swipeable.close(); })}
            overshootRight={false}
            overshootLeft={false}
          >
          <View style={styles.row}>
            <TouchableOpacity style={styles.rowPress} onPress={() => setDetailKitId(item.id)} accessibilityRole="button">
              {item.thumb_uri ? (
                <Image source={{ uri: item.thumb_uri }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={styles.thumbPlaceholder}><IconBox color={colors.textFaint} size={22} /></View>
              )}
              <View style={styles.rowInfo}>
                <Text numberOfLines={1} style={styles.rowName}>{item.name}</Text>
                <Text numberOfLines={1} style={styles.rowSub}>{item.maker}{item.scale ? ` · ${item.scale}` : ''}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.statusBadge, {
                backgroundColor: item.status === 'completed'
                  ? colors.usedUpSoft
                  : (item.status === 'building' ? colors.inUseSoft : colors.primarySoft),
              }]}
              onPress={() => toggleKitStatus(item)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t(STATUS_LABEL_KEYS[item.status])}
            >
              <Text style={[styles.statusBadgeText, { color: item.status === 'completed' ? colors.usedUp : (item.status === 'building' ? colors.inUse : colors.primaryText) }]}>{t(STATUS_LABEL_KEYS[item.status])}</Text>
            </TouchableOpacity>
          </View>
          </Swipeable>
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

      <ListActionBar onAdd={() => setShowAdd(true)} />

      <KitFilterModal
        visible={showFilter}
        options={filterOptions}
        initial={filter}
        onApply={(f) => { setFilter(f); setShowFilter(false); }}
        statusOptions={completedScreen || wishlistScreen ? undefined : STATUS_TOGGLES.map((option) => ({ value: option.key, label: t(option.label) }))}
        initialStatuses={completedScreen || wishlistScreen ? undefined : statuses}
        onApplyStatuses={completedScreen || wishlistScreen ? undefined : setStatuses}
        onClose={() => setShowFilter(false)}
      />

      <AddKitModal
        visible={showAdd}
        defaultBoxId={completedScreen || wishlistScreen || selected === 'all' ? defaultBoxId : selected}
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
  list: { paddingBottom: 104 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  rowPress: { flex: 1, minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: { width: 48, height: 48, borderRadius: radius.sm },
  thumbPlaceholder: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  statusBadge: { minWidth: 56, minHeight: 32, borderRadius: radius.pill, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  statusBadgeText: { fontSize: 12, fontWeight: '700' },
  deleteAction: { width: 88, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  completeAction: { width: 88, backgroundColor: colors.darkAction, alignItems: 'center', justifyContent: 'center' },
  swipeActionText: { color: colors.onPrimary, fontWeight: 'bold' },
});
