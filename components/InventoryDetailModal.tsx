// components/InventoryDetailModal.tsx
// 保管箱の在庫1点を閲覧するモーダル。色そのものの情報(色詳細と重複する部分)は
// 小さめの2列レイアウトに留め、この在庫固有の情報(ボックス・ステータス・追加日・
// 状態変更日・メモ)を主役として大きく扱う。ボックス・ステータスはここで直接変更できる。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconPencil, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { brandLabel } from '../lib/brands';
import {
  getDB,
  getInventoryDetail,
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
import { optionChip } from './PaintFormFields';
import PaintDetailModal from './PaintDetailModal';
import SwipeBack from './SwipeBack';
import SwipeDownHeader from './SwipeDownHeader';

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
    }
  }, [visible, load]);

  const saveNote = async () => {
    if (!detail) return;
    await updateInventoryNote(detail.id, note);
    await load();
    onChanged?.();
  };

  const changeBox = async (boxId: number) => {
    if (!detail) return;
    setBoxPickerOpen(false);
    await updateInventoryBox(detail.id, boxId);
    await load();
    onChanged?.();
  };

  const changeStatus = async (status: PaintStatus) => {
    if (!detail || detail.status === status) return;
    await setInventoryStatus(detail.id, status);
    await load();
    onChanged?.();
  };

  const dateLabel = (value: string | null) => value ? value.slice(0, 10) : t('unknown');
  const boxName = boxes.find((b) => b.id === detail?.box_id)?.name ?? t('unassigned');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SwipeBack enabled={visible} onBack={onClose}>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <SwipeDownHeader onClose={onClose}>
            <View style={styles.header}>
              <Text style={styles.title}>{t('inventoryDetailTitle')}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>

          {!detail ? (
            <Text style={styles.empty}>{t('noResults')}</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
              <View style={[styles.swatch, { backgroundColor: detail.hex ?? colors.transparent, borderColor: detail.hex ?? colors.border }]} />

              <View style={styles.titleRow}>
                <Text style={styles.paintTitle}>{paintName(detail.name_ja, detail.name_en)}</Text>
                <TouchableOpacity style={styles.editBtn} onPress={() => setEditVisible(true)} hitSlop={8}>
                  <IconPencil color={colors.primary} size={20} />
                </TouchableOpacity>
              </View>

              {/* 色そのものの情報(色詳細と重複するため小さめの2列表示に留める) */}
              <View style={styles.compactGrid}>
                <CompactInfo label={t('brand')} value={brandLabel(detail.brand)} styles={styles} />
                <CompactInfo label={t('series')} value={seriesLabel(detail.series, detail.series_en)} styles={styles} />
                <CompactInfo label={t('code')} value={detail.code} styles={styles} />
                <CompactInfo label={t('hex')} value={detail.hex ?? ''} styles={styles} />
                <CompactInfo label={t('paintType')} value={paintTypeLabel(detail.paint_type)} styles={styles} />
                <CompactInfo label={t('gloss')} value={glossLabel(detail.gloss)} styles={styles} />
              </View>

              {/* この在庫固有の情報(主役) */}
              <View style={styles.field}>
                <Text style={styles.label}>{t('box')}</Text>
                <TouchableOpacity style={styles.dropdown} onPress={() => setBoxPickerOpen((o) => !o)}>
                  <Text style={styles.dropdownLabel}>{boxName}</Text>
                  <Text style={styles.dropdownArrow}>{boxPickerOpen ? '▲' : '▼'}</Text>
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
                  {STATUS_OPTIONS.map((opt) => optionChip(opt.value, detail.status === opt.value, t(opt.labelKey), () => changeStatus(opt.value), styles))}
                </View>
              </View>

              <Info label={t('addedAt')} value={dateLabel(detail.added_at)} styles={styles} />
              <Info label={t('statusChangedAt')} value={dateLabel(detail.status_changed_at)} styles={styles} />

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
                boxId={detail.box_id}
                initialEditing
              />
            </ScrollView>
          )}
        </SafeAreaView>
        </SwipeBack>
      </SafeAreaProvider>
    </Modal>
  );
}

function Info({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || '—'}</Text>
    </View>
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
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  paintTitle: { fontSize: 22, fontWeight: 'bold', color: colors.text, flex: 1 },
  editBtn: { padding: spacing.sm, marginLeft: spacing.md },
  compactGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.xl },
  compactItem: { width: '50%', marginBottom: spacing.md },
  compactLabel: { fontSize: 11, color: colors.textMuted },
  compactValue: { fontSize: 13, color: colors.textSecondary },
  infoRow: { paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  infoLabel: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  infoValue: { fontSize: 16, color: colors.text },
  field: { marginBottom: spacing.lg },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text },
  noteInput: { minHeight: 96, alignItems: 'flex-start' },
  dropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.lg },
  dropdownLabel: { fontSize: 16, color: colors.text },
  dropdownArrow: { fontSize: 12, color: colors.textFaint },
  dropdownList: { borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.sm, borderBottomRightRadius: radius.sm, maxHeight: 220 },
  dropdownItem: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderLight },
  dropdownItemText: { fontSize: 15, color: colors.text },
  dropdownItemTextOn: { color: colors.primary, fontWeight: 'bold' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.chip, marginRight: spacing.md, marginBottom: spacing.md },
  chipOn: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, color: colors.textSecondary },
  chipTextOn: { color: colors.onPrimary, fontWeight: 'bold' },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textPlaceholder },
});
