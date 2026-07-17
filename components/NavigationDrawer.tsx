// components/NavigationDrawer.tsx
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconArchive, IconBox, IconBriefcase, IconBuildingWarehouse, IconCircleCheck, IconFlask, IconHistory, IconHeart, IconPackage, IconPalette, IconPlus, IconSettings, IconShoppingCartPlus, IconStack } from '@tabler/icons-react-native';
import { router, usePathname } from 'expo-router';
import { AppMode, useAppMode } from '../lib/appMode';
import { notifyBoxesChanged, setActiveBox, useActiveBox } from '../lib/activeBox';
import { notifyKitBoxesChanged, setActiveKitBox, useActiveKitBox } from '../lib/activeKitBox';
import { getDB } from '../lib/db';
import { t, useLocale } from '../lib/i18n';
import { lightColors, spacing, touch, useTheme } from '../lib/theme';
import BoxEditorModal, { BoxDraft, BoxIcon } from './BoxEditorModal';

interface Box { id: number; name: string; icon: BoxIcon | null; icon_color: string | null; }
interface CountRow { box_id: number | null; n: number; }
interface TotalRow { n: number; }
interface Props { visible: boolean; onClose: () => void; }

export default function NavigationDrawer({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const locale = useLocale();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const pathname = usePathname();
  const appMode = useAppMode();
  const [previewMode, setPreviewMode] = useState<AppMode>(appMode);
  // レイアウト側がドロワーを開くたびにこのコンポーネントを再マウントするため、
  // プレビューは常に「現在表示中の画面のモード」から始まる。
  const mode = previewMode;
  const activeBoxId = useActiveBox();
  const allBoxesLabel = locale === 'ja' ? 'すべてのボックス' : 'All Boxes';
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [boxCounts, setBoxCounts] = useState<Map<number | null, number>>(new Map());
  const [favoriteCount, setFavoriteCount] = useState(0);
  const [wishlistCount, setWishlistCount] = useState(0);
  const [usedCount, setUsedCount] = useState(0);
  const [editingBox, setEditingBox] = useState<'new' | null>(null);
  const activeKitBoxId = useActiveKitBox();
  const [kitBoxes, setKitBoxes] = useState<Box[]>([]);
  const [kitCounts, setKitCounts] = useState<Map<number | null, number>>(new Map());
  const [completedCount, setCompletedCount] = useState(0);
  const [editingKitBox, setEditingKitBox] = useState<'new' | null>(null);

  const loadBoxes = useCallback(async () => {
    const db = getDB();
    const [boxRows, countRows, favoriteRow, wishlistRow, usedRow, kitBoxRows, kitCountRows, completedRow] = await Promise.all([
      db.getAllAsync<Box>('SELECT id, name, icon, icon_color FROM boxes ORDER BY sort_order, id'),
      db.getAllAsync<CountRow>("SELECT box_id, COUNT(*) AS n FROM inventory WHERE status IN ('owned', 'in_use') GROUP BY box_id"),
      db.getFirstAsync<TotalRow>("SELECT COUNT(*) AS n FROM lists WHERE type = 'favorites'"),
      db.getFirstAsync<TotalRow>("SELECT COUNT(*) AS n FROM lists WHERE type = 'wishlist'"),
      db.getFirstAsync<TotalRow>("SELECT COUNT(*) AS n FROM inventory WHERE status = 'used_up'"),
      db.getAllAsync<Box>('SELECT id, name, icon, icon_color FROM kit_boxes ORDER BY sort_order, id'),
      db.getAllAsync<CountRow>("SELECT box_id, COUNT(*) AS n FROM kits WHERE status != 'completed' GROUP BY box_id"),
      db.getFirstAsync<TotalRow>("SELECT COUNT(*) AS n FROM kits WHERE status = 'completed'"),
    ]);
    setBoxes(boxRows);
    setBoxCounts(new Map(countRows.map((row) => [row.box_id, row.n])));
    setFavoriteCount(favoriteRow?.n ?? 0);
    setWishlistCount(wishlistRow?.n ?? 0);
    setUsedCount(usedRow?.n ?? 0);
    setKitBoxes(kitBoxRows);
    setKitCounts(new Map(kitCountRows.map((row) => [row.box_id, row.n])));
    setCompletedCount(completedRow?.n ?? 0);
  }, []);
  useEffect(() => { if (visible) loadBoxes(); }, [visible, loadBoxes]);
  const saveBox = async ({ name, icon, color }: BoxDraft) => {
    const db = getDB();
    if (editingBox === 'new') await db.runAsync('INSERT INTO boxes (name, icon, icon_color, sort_order) VALUES (?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM boxes), 0))', [name, icon, color]);
    notifyBoxesChanged();
    await loadBoxes();
  };
  const saveKitBox = async ({ name, icon, color }: BoxDraft) => {
    const db = getDB();
    if (editingKitBox === 'new') await db.runAsync('INSERT INTO kit_boxes (name, icon, icon_color, sort_order) VALUES (?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM kit_boxes), 0))', [name, icon, color]);
    notifyKitBoxesChanged();
    await loadBoxes();
  };
  const go = (pathname: '/owned' | '/used' | '/favorites' | '/wishlist' | '/catalog' | '/settings', boxId?: number | 'all') => {
    if (pathname === '/owned' && boxId !== undefined) setActiveBox(boxId);
    onClose();
    if (boxId !== undefined) router.navigate({ pathname, params: { boxId: String(boxId) } });
    else router.navigate(pathname);
  };
  const goKits = (boxId: number | 'all') => {
    setActiveKitBox(boxId);
    onClose();
    router.navigate({ pathname: '/kits', params: { boxId: String(boxId) } });
  };
  const goCompleted = () => {
    onClose();
    router.navigate('/completed');
  };
  const item = (label: string, onPress: () => void, icon: ReactNode, active = false, count?: number, key?: string) => (
    <TouchableOpacity key={key} style={[styles.item, active && styles.activeItem]} onPress={onPress} accessibilityRole="button">
      <View style={styles.icon}>{icon}</View><Text style={[styles.itemText, active && styles.activeText]}>{label}</Text>
      {count !== undefined ? <Text style={styles.count}>{count}</Text> : null}
    </TouchableOpacity>
  );
  const boxIcon = (box: Box) => {
    const color = box.icon_color ?? colors.primary;
    if (box.icon === 'archive') return <IconArchive color={color} size={22} />;
    if (box.icon === 'briefcase') return <IconBriefcase color={color} size={22} />;
    if (box.icon === 'warehouse') return <IconBuildingWarehouse color={color} size={22} />;
    if (box.icon === 'package') return <IconPackage color={color} size={22} />;
    if (box.icon === 'flask') return <IconFlask color={color} size={22} />;
    if (box.icon === 'stack') return <IconStack color={color} size={22} />;
    return <IconBox color={color} size={22} />;
  };
  const totalCount = Array.from(boxCounts.values()).reduce((sum, count) => sum + count, 0);
  const kitTotalCount = Array.from(kitCounts.values()).reduce((sum, count) => sum + count, 0);
  const otherMode: AppMode = mode === 'colorack' ? 'kitrack' : 'colorack';
  const otherModeLabel = otherMode === 'colorack' ? 'Colorack' : 'Kitrack';

  return (
        <SafeAreaView edges={['top', 'bottom']} style={styles.drawerContent}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{mode === 'colorack' ? 'Colorack' : 'Kitrack'}</Text>
              <TouchableOpacity onPress={() => setPreviewMode(otherMode)} hitSlop={8} accessibilityRole="button" accessibilityLabel={otherModeLabel}>
                <Text style={styles.modeSwitchText}>{otherModeLabel}</Text>
              </TouchableOpacity>
            </View>
            {mode === 'colorack' ? (
              <>
                {item(allBoxesLabel, () => go('/owned', 'all'), <IconBox color={colors.textMuted} size={22} />, pathname.endsWith('/owned') && activeBoxId === 'all', totalCount)}
                <View style={styles.divider} />
                {boxes.map((box) => item(box.name, () => go('/owned', box.id), boxIcon(box), pathname.endsWith('/owned') && activeBoxId === box.id, boxCounts.get(box.id) ?? 0, `box-${box.id}`))}
                {boxes.length < 8 ? item(t('addBox'), () => setEditingBox('new'), <IconPlus color={colors.primary} size={22} />) : null}
                <View style={styles.divider} />
                {item(t('statusUsedUp'), () => go('/used'), <IconHistory color={colors.textMuted} size={22} />, pathname.endsWith('/used'), usedCount)}
                {item(t('favorites'), () => go('/favorites'), <IconHeart color={colors.textMuted} size={22} />, pathname.endsWith('/favorites'), favoriteCount)}
                {item(t('wishlist'), () => go('/wishlist'), <IconShoppingCartPlus color={colors.textMuted} size={22} />, pathname.endsWith('/wishlist'), wishlistCount)}
              </>
            ) : (
              <>
                {item(allBoxesLabel, () => goKits('all'), <IconBox color={colors.textMuted} size={22} />, pathname.endsWith('/kits') && activeKitBoxId === 'all', kitTotalCount)}
                <View style={styles.divider} />
                {kitBoxes.map((box) => item(box.name, () => goKits(box.id), boxIcon(box), pathname.endsWith('/kits') && activeKitBoxId === box.id, kitCounts.get(box.id) ?? 0, `kitbox-${box.id}`))}
                {kitBoxes.length < 8 ? item(t('addBox'), () => setEditingKitBox('new'), <IconPlus color={colors.primary} size={22} />) : null}
                <View style={styles.divider} />
                {item(t('completedKits'), goCompleted, <IconCircleCheck color={colors.textMuted} size={22} />, pathname.endsWith('/completed'), completedCount)}
              </>
            )}
            <View style={styles.divider} />
            {item(t('catalog'), () => go('/catalog'), <IconPalette color={colors.textMuted} size={22} />, pathname.endsWith('/catalog'))}
            {item(t('settings'), () => go('/settings'), <IconSettings color={colors.textMuted} size={22} />, pathname.endsWith('/settings'))}
          </ScrollView>
          <BoxEditorModal visible={editingBox === 'new'} title={t('addBox')} onSave={saveBox} onClose={() => setEditingBox(null)} />
          <BoxEditorModal visible={editingKitBox === 'new'} title={t('addBox')} onSave={saveKitBox} onClose={() => setEditingKitBox(null)} />
        </SafeAreaView>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  drawerContent: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: spacing.xxl },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xxl, paddingBottom: spacing.xl },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  modeSwitchText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  item: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  activeItem: { backgroundColor: colors.primarySoft },
  icon: { width: 32, alignItems: 'center' },
  itemText: { marginLeft: spacing.md, color: colors.text, fontSize: 16 },
  count: { marginLeft: 'auto', color: colors.textFaint, fontSize: 14, fontVariant: ['tabular-nums'] },
  activeText: { color: colors.primary, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderLight, marginVertical: spacing.sm, marginHorizontal: spacing.xl },
});
