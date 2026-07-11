import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { IconArchive, IconBox, IconBriefcase, IconBuildingWarehouse, IconFlask, IconHistory, IconHeart, IconPackage, IconPalette, IconPlus, IconSettings, IconShoppingCartPlus, IconStack } from '@tabler/icons-react-native';
import { router, usePathname } from 'expo-router';
import { setActiveBox, useActiveBox } from '../lib/activeBox';
import { getDB } from '../lib/db';
import { getLocale, t } from '../lib/i18n';
import { lightColors, spacing, touch, useTheme } from '../lib/theme';
import BoxEditorModal, { BoxDraft, BoxIcon } from './BoxEditorModal';

interface Box { id: number; name: string; icon: BoxIcon | null; icon_color: string | null; }
interface CountRow { box_id: number | null; n: number; }
interface TotalRow { n: number; }
interface Props { visible: boolean; onClose: () => void; }

export default function NavigationDrawer({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const pathname = usePathname();
  const activeBoxId = useActiveBox();
  const allBoxesLabel = getLocale() === 'ja' ? 'すべてのボックス' : 'All Boxes';
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [boxCounts, setBoxCounts] = useState<Map<number | null, number>>(new Map());
  const [favoriteCount, setFavoriteCount] = useState(0);
  const [wishlistCount, setWishlistCount] = useState(0);
  const [usedCount, setUsedCount] = useState(0);
  const [editingBox, setEditingBox] = useState<Box | 'new' | null>(null);
  const [mounted, setMounted] = useState(visible);
  const longPressRef = useRef(false);
  const drawerX = useRef(new Animated.Value(-360)).current;

  const loadBoxes = useCallback(async () => {
    const db = getDB();
    const [boxRows, countRows, favoriteRow, wishlistRow, usedRow] = await Promise.all([
      db.getAllAsync<Box>('SELECT id, name, icon, icon_color FROM boxes ORDER BY id'),
      db.getAllAsync<CountRow>("SELECT box_id, COUNT(*) AS n FROM inventory WHERE status IN ('owned', 'in_use') GROUP BY box_id"),
      db.getFirstAsync<TotalRow>("SELECT COUNT(*) AS n FROM lists WHERE type = 'favorites'"),
      db.getFirstAsync<TotalRow>("SELECT COUNT(*) AS n FROM lists WHERE type = 'wishlist'"),
      db.getFirstAsync<TotalRow>("SELECT COUNT(*) AS n FROM inventory WHERE status = 'used_up'"),
    ]);
    setBoxes(boxRows);
    setBoxCounts(new Map(countRows.map((row) => [row.box_id, row.n])));
    setFavoriteCount(favoriteRow?.n ?? 0);
    setWishlistCount(wishlistRow?.n ?? 0);
    setUsedCount(usedRow?.n ?? 0);
  }, []);
  useEffect(() => { if (visible) loadBoxes(); }, [visible, loadBoxes]);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(drawerX, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    } else if (mounted) {
      Animated.timing(drawerX, { toValue: -360, duration: 180, useNativeDriver: true }).start(() => setMounted(false));
    }
  }, [drawerX, mounted, visible]);
  const saveBox = async ({ name, icon, color }: BoxDraft) => {
    const db = getDB();
    if (editingBox === 'new') await db.runAsync('INSERT INTO boxes (name, icon, icon_color) VALUES (?, ?, ?)', [name, icon, color]);
    else if (editingBox) await db.runAsync('UPDATE boxes SET name = ?, icon = ?, icon_color = ? WHERE id = ?', [name, icon, color, editingBox.id]);
    await loadBoxes();
  };
  const go = (pathname: '/owned' | '/used' | '/favorites' | '/wishlist' | '/catalog' | '/settings', boxId?: number | 'all') => {
    if (pathname === '/owned' && boxId !== undefined) setActiveBox(boxId);
    onClose();
    if (boxId !== undefined) router.navigate({ pathname, params: { boxId: String(boxId) } });
    else router.navigate(pathname);
  };
  const item = (label: string, onPress: () => void, icon: ReactNode, active = false, count?: number, onLongPress?: () => void) => (
    <TouchableOpacity style={[styles.item, active && styles.activeItem]} onPress={() => { if (longPressRef.current) { longPressRef.current = false; return; } onPress(); }} onLongPress={onLongPress ? () => { longPressRef.current = true; onLongPress(); } : undefined} accessibilityRole="button">
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
  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <SafeAreaProvider>
      <View style={styles.root}>
        <Animated.View style={[styles.drawer, { transform: [{ translateX: drawerX }] }]}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.drawerContent}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>Colorack</Text>
            {item(allBoxesLabel, () => go('/owned', 'all'), <IconBox color={colors.textMuted} size={22} />, pathname.endsWith('/owned') && activeBoxId === 'all', boxCounts.get(null) ?? Array.from(boxCounts.values()).reduce((sum, count) => sum + count, 0))}
            <View style={styles.divider} />
            {boxes.map((box) => item(box.name, () => go('/owned', box.id), boxIcon(box), pathname.endsWith('/owned') && activeBoxId === box.id, boxCounts.get(box.id) ?? 0, () => setEditingBox(box)))}
            {item(t('addBox'), () => setEditingBox('new'), <IconPlus color={colors.primary} size={22} />)}
            <View style={styles.divider} />
            {item(t('statusUsedUp'), () => go('/used'), <IconHistory color={colors.textMuted} size={22} />, pathname.endsWith('/used'), usedCount)}
            {item(t('favorites'), () => go('/favorites'), <IconHeart color={colors.textMuted} size={22} />, pathname.endsWith('/favorites'), favoriteCount)}
            {item(t('wishlist'), () => go('/wishlist'), <IconShoppingCartPlus color={colors.textMuted} size={22} />, pathname.endsWith('/wishlist'), wishlistCount)}
            <View style={styles.divider} />
            {item(t('catalog'), () => go('/catalog'), <IconPalette color={colors.textMuted} size={22} />, pathname.endsWith('/catalog'))}
            {item(t('settings'), () => go('/settings'), <IconSettings color={colors.textMuted} size={22} />, pathname.endsWith('/settings'))}
          </ScrollView>
        </SafeAreaView></Animated.View>
        <Pressable style={styles.backdrop} onPress={onClose} />
      </View>
      <BoxEditorModal visible={editingBox != null} title={editingBox === 'new' ? t('addBox') : t('rename')} initial={editingBox && editingBox !== 'new' ? { name: editingBox.name, icon: editingBox.icon ?? 'box', color: editingBox.icon_color ?? colors.primary } : undefined} onSave={saveBox} onClose={() => setEditingBox(null)} />
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  backdrop: { flex: 1 },
  drawer: { width: '82%', maxWidth: 360, backgroundColor: colors.surface },
  drawerContent: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: spacing.xxl },
  title: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xl, fontSize: 22, fontWeight: '700', color: colors.text },
  item: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  activeItem: { backgroundColor: colors.primarySoft },
  icon: { width: 32, alignItems: 'center' },
  itemText: { marginLeft: spacing.md, color: colors.text, fontSize: 16 },
  count: { marginLeft: 'auto', color: colors.textFaint, fontSize: 14, fontVariant: ['tabular-nums'] },
  activeText: { color: colors.primary, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderLight, marginVertical: spacing.sm, marginHorizontal: spacing.xl },
});
