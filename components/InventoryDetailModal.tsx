// components/InventoryDetailModal.tsx
// 保管箱の在庫1点を閲覧するモーダル。色そのものの情報(色詳細と重複する部分)は
// 小さめの2列レイアウトに留め、この在庫固有の情報(ボックス・ステータス・追加日・
// 最終更新日・メモ)を主役として大きく扱う。ボックス・ステータスはここで直接変更できる。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconChevronDown, IconChevronRight, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { brandLabel } from '../lib/brands';
import {
  getDB,
  getInventoryDetail,
  getListMembership,
  InventoryDetail,
  PaintStatus,
  setInventoryStatus,
  updateInventoryBox,
  updateInventoryNote,
} from '../lib/db';
import { glossLabel } from '../lib/gloss';
import { t } from '../lib/i18n';
import { paintName, seriesLabel } from '../lib/paintLabel';
import { paintTypeLabel } from '../lib/paintType';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';
import ActionSheet from './ActionSheet';
import PaintDetailModal from './PaintDetailModal';
import SwipeBack from './SwipeBack';
import SwipeDownHeader from './SwipeDownHeader';
import SwipeDownScrollView from './SwipeDownScrollView';
import Toast from './Toast';
import { useModalLock } from '../lib/modalLock';

interface Box { id: number; name: string; }

const STATUS_OPTIONS: { value: PaintStatus; labelKey: string }[] = [
  { value: 'owned', labelKey: 'statusOwned' },
  { value: 'in_use', labelKey: 'statusInUse' },
  { value: 'used_up', labelKey: 'statusUsedUp' },
];

interface Props {
  visible: boolean;
  inventoryId: number | null;
  onClose: () => void;
  onChanged?: () => void;
}

function readableTextColor(hex: string | null): string {
  const value = hex?.replace('#', '');
  if (!value || !/^[0-9a-f]{6}$/i.test(value)) return '#333';
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#222' : '#fff';
}

function toneColors(hex: string | null): string[] {
  const value = hex?.replace('#', '');
  if (!value || !/^[0-9a-f]{6}$/i.test(value)) return ['#e5e5e5', '#ccc', '#aaa', '#888', '#666', '#444'];
  const base = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
  return [-0.55, -0.3, -0.1, 0.1, 0.3, 0.55].map((amount) => {
    const channel = (value: number) => Math.round(amount < 0 ? value * (1 + amount) : value + (255 - value) * amount);
    return `rgb(${channel(base[0])}, ${channel(base[1])}, ${channel(base[2])})`;
  });
}

export default function InventoryDetailModal({ visible, inventoryId, onClose, onChanged }: Props) {
  useModalLock(visible);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [detail, setDetail] = useState<InventoryDetail | null>(null);
  const [note, setNote] = useState('');
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [boxPickerOpen, setBoxPickerOpen] = useState(false);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [colorDetailVisible, setColorDetailVisible] = useState(false);
  const [showFullName, setShowFullName] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (inventoryId == null) return;
    const row = await getInventoryDetail(inventoryId);
    setDetail(row);
    setNote(row?.note ?? '');
  }, [inventoryId]);

  useEffect(() => {
    if (visible) {
      load();
      getDB().getAllAsync<Box>('SELECT id, name FROM boxes ORDER BY sort_order, id').then(setBoxes);
    } else {
      setDetail(null);
      setNote('');
      setBoxPickerOpen(false);
      setStatusPickerOpen(false);
      setColorDetailVisible(false);
      setToast('');
    }
  }, [visible, load]);

  useEffect(() => setShowFullName(false), [inventoryId, visible]);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1800);
  };

  const saveNote = async () => {
    if (!detail) return;
    if (note === (detail.note ?? '')) return;
    await updateInventoryNote(detail.id, note);
    await load();
    onChanged?.();
    showToast(t('noteSavedToast'));
  };

  const closeAfterSavingNote = async () => {
    if (detail && note !== (detail.note ?? '')) {
      await updateInventoryNote(detail.id, note);
      onChanged?.();
    }
    onClose();
  };

  const changeBox = async (boxId: number) => {
    if (!detail) return;
    setBoxPickerOpen(false);
    await updateInventoryBox(detail.id, boxId);
    await load();
    onChanged?.();
  };

  // 削除確認と同じネイティブAlertを使う。ActionSheetだと背後のモーダル内容が
  // 半透明背景越しに透けて見える問題があった(ネイティブAlertはOSが別レイヤーで描画する)。
  const promptAddToWishlist = (item: InventoryDetail) => {
    Alert.alert(t('addToWishlistPrompt'), '', [
      {
        text: t('cancel'), style: 'cancel',
      },
      { text: t('dontAddToList'), onPress: async () => { await setInventoryStatus(item.id, 'used_up'); await load(); onChanged?.(); showToast(paintName(item.name_ja, item.name_en) + t('usedUpToast')); } },
      {
        text: t('add'),
        onPress: async () => {
          const membership = await getListMembership(item.paint_id);
          if (!membership.wishlist) {
            await getDB().runAsync("INSERT OR IGNORE INTO lists (type, paint_id) VALUES ('wishlist', ?)", [item.paint_id]);
          }
          await setInventoryStatus(item.id, 'used_up');
          await load();
          onChanged?.();
          showToast(paintName(item.name_ja, item.name_en) + t('usedUpToast'));
        },
      },
    ]);
  };

  const changeStatus = async (status: PaintStatus) => {
    if (!detail || detail.status === status) return;
    const previous = detail;
    if (status === 'used_up') { promptAddToWishlist(previous); return; }
    await setInventoryStatus(detail.id, status);
    await load();
    onChanged?.();
  };

  // datetime('now') は 'YYYY-MM-DD HH:MM:SS' 形式なので秒を切り落として表示。
  const dateLabel = (value: string | null) => value ? value.slice(0, 16) : t('unknown');
  const boxName = boxes.find((b) => b.id === detail?.box_id)?.name ?? t('unassigned');
  const finish = detail?.gloss === 'メタリック' || detail?.gloss === 'パール';
  const swatchColor = detail?.hex || colors.transparent;
  const swatchTextColor = detail?.hex ? readableTextColor(detail.hex) : colors.text;
  const tooltipBackground = detail?.hex
    ? (swatchTextColor === '#fff' ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.92)')
    : colors.surface;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={closeAfterSavingNote}>
      <SafeAreaProvider>
        <SwipeBack enabled={visible && !colorDetailVisible} onBack={closeAfterSavingNote}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <SwipeDownHeader onClose={colorDetailVisible ? () => {} : closeAfterSavingNote}>
            <View style={styles.header}>
              <Text style={styles.title}>{t('inventoryDetailTitle')}</Text>
              <TouchableOpacity onPress={closeAfterSavingNote} hitSlop={8}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>

          {!detail ? (
            <Text style={styles.empty}>{t('noResults')}</Text>
          ) : (
            <SwipeDownScrollView style={styles.scroll} onClose={colorDetailVisible ? () => {} : closeAfterSavingNote} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.md }]} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
              <View style={styles.colorSpecimen}>
              <View style={[styles.swatch, { backgroundColor: swatchColor }]}>
                {finish ? (
                  <View pointerEvents="none" style={styles.finishOverlay}>
                    <Svg width="100%" height="100%" preserveAspectRatio="none">
                      <Defs>
                        <LinearGradient id="inventory-metallic-sheen" x1="0" y1="1" x2="1" y2="0">
                          <Stop offset="0" stopColor="#fff" stopOpacity={0} />
                          <Stop offset="1" stopColor="#fff" stopOpacity={0.34} />
                        </LinearGradient>
                      </Defs>
                      <Rect width="100%" height="100%" fill="url(#inventory-metallic-sheen)" />
                    </Svg>
                  </View>
                ) : null}
                <View style={styles.swatchLabel}>
                  <View style={styles.swatchBrandRow}>
                    <Text selectable style={[styles.swatchBrand, { color: swatchTextColor }]}>{brandLabel(detail.brand) || '—'}</Text>
                    <TouchableOpacity style={styles.editBtn} onPress={() => setColorDetailVisible(true)} hitSlop={8} accessibilityLabel={t('paintDetailTitle')}>
                      <IconChevronRight color={swatchTextColor} size={22} />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => setShowFullName((shown) => !shown)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={paintName(detail.name_ja, detail.name_en)}>
                    <Text selectable numberOfLines={1} style={[styles.swatchName, { color: swatchTextColor }]}>{paintName(detail.name_ja, detail.name_en)}</Text>
                  </TouchableOpacity>
                  {showFullName ? (
                    <View style={[styles.nameTooltip, { backgroundColor: tooltipBackground }]}>
                      <Text selectable style={[styles.nameTooltipText, { color: swatchTextColor }]}>{paintName(detail.name_ja, detail.name_en)}</Text>
                    </View>
                  ) : null}
                  {detail.code ? <Text selectable style={[styles.swatchCode, { color: swatchTextColor }]}>{detail.code}</Text> : null}
                  {detail.hex ? <Text selectable style={[styles.swatchHex, { color: swatchTextColor }]}>{detail.hex.toUpperCase()}</Text> : null}
                </View>
              </View>
              <View style={styles.toneRail}>
                {toneColors(detail.hex).map((color, index) => <View key={index} style={[styles.toneStep, { backgroundColor: color }]} />)}
              </View>
              </View>

              <View style={styles.detailCard}>
                <CompactInfo label={t('brand')} value={brandLabel(detail.brand)} styles={styles} />
                <CompactInfo label={t('series')} value={seriesLabel(detail.series, detail.series_en)} styles={styles} />
                <CompactInfo label={t('paintType')} value={paintTypeLabel(detail.paint_type)} styles={styles} />
                <CompactInfo label={t('gloss')} value={glossLabel(detail.gloss)} styles={styles} />
              </View>

              <View style={styles.ledgerCard}>
                <Text style={styles.sectionTitle}>{t('paintNotes')}</Text>
                <Text style={styles.quote}>{detail.paint_notes || '—'}</Text>
              </View>

              <View style={styles.inventoryControlCard}>
                <View style={styles.inventoryControl}>
                  <Text style={styles.sectionTitle}>{t('box')}</Text>
                  <TouchableOpacity style={styles.compactPicker} onPress={() => setBoxPickerOpen(true)} disabled={detail.status === 'used_up'}>
                    <Text numberOfLines={1} style={[styles.compactPickerText, detail.status === 'used_up' && styles.disabledText]}>{boxName}</Text>
                    <IconChevronDown size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
                <View style={styles.inventoryDivider} />
                <View style={styles.inventoryControl}>
                  <Text style={styles.sectionTitle}>{t('status')}</Text>
                  <TouchableOpacity style={styles.compactPicker} onPress={() => setStatusPickerOpen(true)}>
                    <Text numberOfLines={1} style={styles.compactPickerText}>{t(STATUS_OPTIONS.find((option) => option.value === detail.status)?.labelKey ?? 'status')}</Text>
                    <IconChevronDown size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.detailCard}>
                <CompactInfo label={t('addedAt')} value={dateLabel(detail.added_at)} styles={styles} />
                <CompactInfo label={t('lastUpdatedAt')} value={dateLabel(detail.status_changed_at ?? detail.added_at)} styles={styles} />
              </View>

              <View style={styles.ledgerCard}>
                <Text style={styles.sectionTitle}>在庫メモ</Text>
                <ClearableInput
                  style={[styles.input, styles.noteInput]}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  textAlignVertical="top"
                  onBlur={saveNote}
                />
              </View>

            </SwipeDownScrollView>
          )}
          <Toast message={toast} />
          <ActionSheet
            visible={boxPickerOpen}
            title={t('box')}
            buttons={[
              ...boxes.map((box) => ({ text: `${box.id === detail?.box_id ? '✓ ' : ''}${box.name}`, onPress: () => changeBox(box.id) })),
              { text: t('cancel'), style: 'cancel' },
            ]}
            onClose={() => setBoxPickerOpen(false)}
          />
          <ActionSheet
            visible={statusPickerOpen}
            title={t('status')}
            buttons={[
              ...STATUS_OPTIONS.map((option) => ({ text: `${option.value === detail?.status ? '✓ ' : ''}${t(option.labelKey)}`, onPress: () => changeStatus(option.value) })),
              { text: t('cancel'), style: 'cancel' },
            ]}
            onClose={() => setStatusPickerOpen(false)}
          />
          <PaintDetailModal
            visible={colorDetailVisible}
            paintId={detail?.paint_id ?? null}
            onClose={() => setColorDetailVisible(false)}
            onChanged={load}
          />
        </SafeAreaView>
        </SwipeBack>
      </SafeAreaProvider>
    </Modal>
  );
}

function CompactInfo({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.compactItem}>
      <Text style={styles.compactLabel}>{label}</Text>
      <Text style={styles.compactValue}>{value || '—'}</Text>
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  scroll: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg },
  colorSpecimen: { overflow: 'hidden', borderRadius: radius.md, borderCurve: 'continuous', borderWidth: 1, borderColor: colors.borderLight },
  swatch: { height: 156, overflow: 'hidden', justifyContent: 'flex-end', paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl },
  finishOverlay: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  swatchLabel: { gap: spacing.xs, zIndex: 1, position: 'relative' },
  swatchBrandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  swatchBrand: { fontSize: 14, fontWeight: '600', opacity: 0.82 },
  swatchName: { fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.3 },
  swatchCode: { fontSize: 18, fontWeight: '600', marginTop: spacing.xs },
  swatchHex: { fontSize: 13, fontWeight: '600', opacity: 0.84, letterSpacing: 0.6 },
  nameTooltip: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, zIndex: 2 },
  nameTooltipText: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  editBtn: { padding: spacing.sm, marginRight: -spacing.sm },
  toneRail: { height: 34, flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.18)' },
  toneStep: { flex: 1 },
  detailCard: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, paddingTop: spacing.lg },
  compactItem: { width: '50%', paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  compactLabel: { fontSize: 11, color: colors.textMuted },
  compactValue: { fontSize: 15, color: colors.text, fontWeight: '600', marginTop: 2 },
  ledgerCard: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  sectionTitle: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text },
  quote: { fontSize: 14, lineHeight: 20, color: colors.textSecondary },
  noteInput: { minHeight: 72, alignItems: 'flex-start' },
  inventoryControlCard: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.lg, gap: spacing.lg },
  inventoryControl: { flex: 1, gap: spacing.sm },
  inventoryDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.borderLight },
  compactPicker: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  compactPickerText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  disabledText: { color: colors.textFaint },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textPlaceholder },
});
