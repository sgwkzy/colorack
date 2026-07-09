// components/InventoryDetailModal.tsx
// 保管箱の在庫1点を閲覧するモーダル。色そのものの情報(色詳細と重複する部分)は
// 小さめの2列レイアウトに留め、この在庫固有の情報(ボックス・ステータス・追加日・
// 最終更新日・メモ)を主役として大きく扱う。ボックス・ステータスはここで直接変更できる。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconChevronDown, IconChevronUp, IconPencil, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
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
import ActionSheet, { ActionSheetButton } from './ActionSheet';
import ClearableInput from './ClearableInput';
import PaintDetailModal from './PaintDetailModal';
import SwipeBack from './SwipeBack';
import SwipeDownHeader from './SwipeDownHeader';
import Toast from './Toast';

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

export default function InventoryDetailModal({ visible, inventoryId, onClose, onChanged }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [detail, setDetail] = useState<InventoryDetail | null>(null);
  const [note, setNote] = useState('');
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [boxPickerOpen, setBoxPickerOpen] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [actionSheet, setActionSheet] = useState<{ title?: string; message?: string; buttons: ActionSheetButton[] } | null>(null);
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
      getDB().getAllAsync<Box>('SELECT id, name FROM boxes ORDER BY id').then(setBoxes);
    } else {
      setDetail(null);
      setNote('');
      setBoxPickerOpen(false);
      setEditVisible(false);
      setActionSheet(null);
      setToast('');
    }
  }, [visible, load]);

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

  const promptAddToWishlist = (item: InventoryDetail) => {
    setActionSheet({ title: t('addToWishlistPrompt'), message: '', buttons: [
      { text: t('dontAddToList'), style: 'cancel' },
      {
        text: t('add'),
        onPress: async () => {
          const membership = await getListMembership(item.paint_id);
          if (!membership.wishlist) {
            await getDB().runAsync("INSERT INTO lists (type, paint_id) VALUES ('wishlist', ?)", [item.paint_id]);
          }
          onChanged?.();
          showToast(paintName(item.name_ja, item.name_en) + t('addedToast'));
        },
      },
    ] });
  };

  const changeStatus = async (status: PaintStatus) => {
    if (!detail || detail.status === status) return;
    const previous = detail;
    await setInventoryStatus(detail.id, status);
    await load();
    onChanged?.();
    if (status === 'used_up') promptAddToWishlist(previous);
  };

  // datetime('now') は 'YYYY-MM-DD HH:MM:SS' 形式なので秒を切り落として表示。
  const dateLabel = (value: string | null) => value ? value.slice(0, 16) : t('unknown');
  const boxName = boxes.find((b) => b.id === detail?.box_id)?.name ?? t('unassigned');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={closeAfterSavingNote}>
      <SafeAreaProvider>
        <SwipeBack enabled={visible} onBack={closeAfterSavingNote}>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <SwipeDownHeader onClose={closeAfterSavingNote}>
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
            <ScrollView contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
              <View style={[styles.swatch, { backgroundColor: detail.hex ?? colors.transparent, borderColor: colors.border }]}>
                {detail.hex ? <Text style={styles.hexBadge}>{detail.hex.toUpperCase()}</Text> : null}
              </View>

              <View style={styles.titleRow}>
                <Text style={styles.paintTitle}>{paintName(detail.name_ja, detail.name_en)}</Text>
                <TouchableOpacity style={styles.editBtn} onPress={() => setEditVisible(true)} hitSlop={8}>
                  <IconPencil color={colors.primary} size={20} />
                </TouchableOpacity>
              </View>
              {detail.code ? <Text style={styles.codeLine}>{detail.code}</Text> : null}

              {/* 色そのものの情報(色詳細と重複するため小さめの2列表示に留める) */}
              <View style={styles.compactGrid}>
                <CompactInfo label={t('brand')} value={brandLabel(detail.brand)} styles={styles} />
                <CompactInfo label={t('series')} value={seriesLabel(detail.series, detail.series_en)} styles={styles} />
                <CompactInfo label={t('paintType')} value={paintTypeLabel(detail.paint_type)} styles={styles} />
                <CompactInfo label={t('gloss')} value={glossLabel(detail.gloss)} styles={styles} />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t('paintNotes')}</Text>
                <Text style={styles.quote}>{detail.paint_notes || '—'}</Text>
              </View>

              <View style={styles.divider} />

              {/* この在庫固有の情報(主役) */}
              <View style={styles.field}>
                <Text style={styles.label}>{t('box')}</Text>
                <TouchableOpacity style={styles.dropdown} onPress={() => setBoxPickerOpen((o) => !o)}>
                  <Text style={styles.dropdownLabel}>{boxName}</Text>
                  {boxPickerOpen
                    ? <IconChevronUp size={16} color={colors.textFaint} />
                    : <IconChevronDown size={16} color={colors.textFaint} />}
                </TouchableOpacity>
                {boxPickerOpen && (
                  <ScrollView style={styles.dropdownList} nestedScrollEnabled>
                    {boxes.map((b) => (
                      <TouchableOpacity key={b.id} style={styles.dropdownItem} onPress={() => changeBox(b.id)}>
                        <Text style={[styles.dropdownItemText, detail.box_id === b.id && styles.dropdownItemTextOn]}>{b.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t('status')}</Text>
                <View style={styles.chipRow}>
                  {STATUS_OPTIONS.map((opt) => {
                    const selected = detail.status === opt.value;
                    const statusColor = opt.value === 'owned' ? colors.primary : opt.value === 'in_use' ? colors.inUse : colors.usedUp;
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[styles.chip, selected && { backgroundColor: statusColor }]}
                        onPress={() => changeStatus(opt.value)}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextOn]}>{t(opt.labelKey)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.compactGrid}>
                <CompactInfo label={t('addedAt')} value={dateLabel(detail.added_at)} styles={styles} />
                <CompactInfo label={t('lastUpdatedAt')} value={dateLabel(detail.status_changed_at)} styles={styles} />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t('note')}</Text>
                <ClearableInput
                  style={[styles.input, styles.noteInput]}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  textAlignVertical="top"
                  onBlur={saveNote}
                />
              </View>

              <PaintDetailModal
                visible={editVisible}
                paintId={detail.paint_id}
                onClose={() => setEditVisible(false)}
                onChanged={load}
                initialEditing
              />
            </ScrollView>
          )}
          <ActionSheet
            visible={!!actionSheet}
            title={actionSheet?.title}
            message={actionSheet?.message}
            buttons={actionSheet?.buttons ?? []}
            onClose={() => setActionSheet(null)}
          />
          <Toast message={actionSheet ? '' : toast} />
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
  content: { padding: spacing.xl, paddingBottom: 96 },
  swatch: { height: 96, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.xl },
  hexBadge: { position: 'absolute', right: spacing.md, bottom: spacing.md, fontSize: 11, paddingHorizontal: spacing.md, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.9)', color: '#333', overflow: 'hidden' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  paintTitle: { fontSize: 22, fontWeight: 'bold', color: colors.text, flex: 1 },
  codeLine: { fontSize: 14, color: colors.textMuted, letterSpacing: 0.5, marginBottom: spacing.lg },
  editBtn: { padding: spacing.sm, marginLeft: spacing.md },
  compactGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.xl },
  compactItem: { width: '50%', marginBottom: spacing.md },
  compactLabel: { fontSize: 11, color: colors.textMuted },
  compactValue: { fontSize: 13, color: colors.textSecondary },
  field: { marginBottom: spacing.lg },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.border, borderRadius: 0, paddingLeft: 10, paddingVertical: 2, fontSize: 12, color: colors.textFaint },
  divider: { borderTopWidth: 1, borderTopColor: colors.borderLight, marginBottom: spacing.lg },
  noteInput: { minHeight: 96, alignItems: 'flex-start' },
  dropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.lg },
  dropdownLabel: { fontSize: 16, color: colors.text },
  dropdownList: { borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.sm, borderBottomRightRadius: radius.sm, maxHeight: 220 },
  dropdownItem: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderLight },
  dropdownItemText: { fontSize: 15, color: colors.text },
  dropdownItemTextOn: { color: colors.primary, fontWeight: 'bold' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.chip, marginRight: spacing.md, marginBottom: spacing.md },
  chipText: { fontSize: 13, color: colors.textSecondary },
  chipTextOn: { color: colors.onPrimary, fontWeight: 'bold' },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textPlaceholder },
});
