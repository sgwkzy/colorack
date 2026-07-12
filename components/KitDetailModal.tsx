// components/KitDetailModal.tsx
import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconChevronDown, IconDotsVertical, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  deleteKit,
  getKitDetail,
  getKitPaints,
  KitDetail,
  KitPaintRow as KitPaintRowData,
  KitStatus,
  removeKitPaint,
  setKitStatus,
  updateKitBox,
  updateKitNote,
  updateKitPaintNote,
  updateKitPhoto,
} from '../lib/db';
import { deleteKitPhoto } from '../lib/kitPhoto';
import { getDB } from '../lib/db';
import { t } from '../lib/i18n';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
import ActionSheet from './ActionSheet';
import ClearableInput from './ClearableInput';
import KitPaintPickerModal from './KitPaintPickerModal';
import KitPaintRow from './KitPaintRow';
import KitPhotoPicker from './KitPhotoPicker';
import SwipeBack from './SwipeBack';
import SwipeDownHeader from './SwipeDownHeader';
import SwipeDownScrollView from './SwipeDownScrollView';

interface Box { id: number; name: string; }

const STATUS_OPTIONS: { value: KitStatus; labelKey: string }[] = [
  { value: 'not_started', labelKey: 'statusNotStarted' },
  { value: 'building', labelKey: 'statusBuilding' },
  { value: 'completed', labelKey: 'statusCompleted' },
];

interface Props {
  visible: boolean;
  kitId: number | null;
  onClose: () => void;
  onChanged?: () => void;
}

export default function KitDetailModal({ visible, kitId, onClose, onChanged }: Props) {
  useModalLock(visible);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [detail, setDetail] = useState<KitDetail | null>(null);
  const [paints, setPaints] = useState<KitPaintRowData[]>([]);
  const [note, setNote] = useState('');
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [boxPickerOpen, setBoxPickerOpen] = useState(false);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    if (kitId == null) return;
    const [row, paintRows] = await Promise.all([getKitDetail(kitId), getKitPaints(kitId)]);
    setDetail(row);
    setPaints(paintRows);
    setNote(row?.note ?? '');
  }, [kitId]);

  useEffect(() => {
    if (visible) {
      load();
      getDB().getAllAsync<Box>('SELECT id, name FROM kit_boxes ORDER BY sort_order, id').then(setBoxes);
    } else {
      setDetail(null);
      setPaints([]);
      setNote('');
      setBoxPickerOpen(false);
      setStatusPickerOpen(false);
      setPickerOpen(false);
      setMenuOpen(false);
    }
  }, [visible, load]);

  const saveNote = async () => {
    if (!detail) return;
    if (note === (detail.note ?? '')) return;
    await updateKitNote(detail.id, note);
    await load();
    onChanged?.();
  };

  const closeAfterSavingNote = async () => {
    if (detail && note !== (detail.note ?? '')) {
      await updateKitNote(detail.id, note);
      onChanged?.();
    }
    onClose();
  };

  const changeBox = async (boxId: number) => {
    if (!detail) return;
    setBoxPickerOpen(false);
    await updateKitBox(detail.id, boxId);
    await load();
    onChanged?.();
  };

  const changeStatus = async (status: KitStatus) => {
    if (!detail || detail.status === status) return;
    setStatusPickerOpen(false);
    await setKitStatus(detail.id, status);
    await load();
    onChanged?.();
  };

  const changePhoto = async (uri: string | null) => {
    if (!detail) return;
    const previous = detail.photo_uri;
    await updateKitPhoto(detail.id, uri);
    if (previous && previous !== uri) await deleteKitPhoto(previous);
    await load();
    onChanged?.();
  };

  const removePaint = async (kitPaintId: number) => {
    await removeKitPaint(kitPaintId);
    await load();
  };

  const changePaintNote = async (kitPaintId: number, next: string) => {
    await updateKitPaintNote(kitPaintId, next);
    await load();
  };

  const confirmDelete = () => {
    if (!detail) return;
    setMenuOpen(false);
    Alert.alert(detail.name, t('deleteKitConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'), style: 'destructive',
        onPress: async () => {
          await deleteKit(detail.id);
          if (detail.photo_uri) await deleteKitPhoto(detail.photo_uri);
          onChanged?.();
          onClose();
        },
      },
    ]);
  };

  const boxName = boxes.find((b) => b.id === detail?.box_id)?.name ?? t('unassigned');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={closeAfterSavingNote}>
      <SafeAreaProvider>
        <SwipeBack enabled={visible} onBack={closeAfterSavingNote}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <SwipeDownHeader onClose={closeAfterSavingNote}>
            <View style={styles.header}>
              <Text style={styles.title}>{t('kitDetailTitle')}</Text>
              <View style={styles.headerActions}>
                <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={8}>
                  <IconDotsVertical color={colors.text} size={22} />
                </TouchableOpacity>
                <TouchableOpacity onPress={closeAfterSavingNote} hitSlop={8}>
                  <IconX color={colors.text} size={24} />
                </TouchableOpacity>
              </View>
            </View>
          </SwipeDownHeader>

          {!detail ? (
            <Text style={styles.empty}>{t('noResults')}</Text>
          ) : (
            <SwipeDownScrollView style={styles.scroll} onClose={closeAfterSavingNote} contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
              <View style={styles.topRow}>
                <KitPhotoPicker photoUri={detail.photo_uri} onChange={changePhoto} />
                <View style={styles.titleBlock}>
                  <Text style={styles.name}>{detail.name}</Text>
                  <Text style={styles.maker}>{detail.maker}{detail.scale ? ` · ${detail.scale}` : ''}</Text>
                </View>
              </View>

              <View style={styles.controlCard}>
                <View style={styles.control}>
                  <Text style={styles.sectionTitle}>{t('box')}</Text>
                  <TouchableOpacity style={styles.picker} onPress={() => setBoxPickerOpen(true)}>
                    <Text numberOfLines={1} style={styles.pickerText}>{boxName}</Text>
                    <IconChevronDown size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
                <View style={styles.divider} />
                <View style={styles.control}>
                  <Text style={styles.sectionTitle}>{t('status')}</Text>
                  <TouchableOpacity style={styles.picker} onPress={() => setStatusPickerOpen(true)}>
                    <Text numberOfLines={1} style={styles.pickerText}>{t(STATUS_OPTIONS.find((o) => o.value === detail.status)?.labelKey ?? 'status')}</Text>
                    <IconChevronDown size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t('note')}</Text>
                <ClearableInput
                  style={[styles.input, styles.noteInput]}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  textAlignVertical="top"
                  onBlur={saveNote}
                />
              </View>

              <View style={styles.paintsSection}>
                <View style={styles.paintsHeader}>
                  <Text style={styles.sectionTitle}>{t('usedPaints')}</Text>
                  <TouchableOpacity onPress={() => setPickerOpen(true)}>
                    <Text style={styles.addLink}>{t('addColor')}</Text>
                  </TouchableOpacity>
                </View>
                {paints.map((row) => (
                  <KitPaintRow
                    key={row.id}
                    row={row}
                    onNoteChange={(next) => changePaintNote(row.id, next)}
                    onRemove={() => removePaint(row.id)}
                  />
                ))}
              </View>
            </SwipeDownScrollView>
          )}

          <ActionSheet
            visible={boxPickerOpen}
            title={t('box')}
            buttons={[
              ...boxes.map((b) => ({ text: `${b.id === detail?.box_id ? '✓ ' : ''}${b.name}`, onPress: () => changeBox(b.id) })),
              { text: t('cancel'), style: 'cancel' },
            ]}
            onClose={() => setBoxPickerOpen(false)}
          />
          <ActionSheet
            visible={statusPickerOpen}
            title={t('status')}
            buttons={[
              ...STATUS_OPTIONS.map((o) => ({ text: `${o.value === detail?.status ? '✓ ' : ''}${t(o.labelKey)}`, onPress: () => changeStatus(o.value) })),
              { text: t('cancel'), style: 'cancel' },
            ]}
            onClose={() => setStatusPickerOpen(false)}
          />
          <ActionSheet
            visible={menuOpen}
            buttons={[
              { text: t('delete'), style: 'destructive', onPress: confirmDelete },
              { text: t('cancel'), style: 'cancel' },
            ]}
            onClose={() => setMenuOpen(false)}
          />
          {detail ? (
            <KitPaintPickerModal
              visible={pickerOpen}
              kitId={detail.id}
              onClose={() => setPickerOpen(false)}
              onAdded={load}
            />
          ) : null}
        </SafeAreaView>
        </SwipeBack>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  title: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, gap: spacing.lg },
  topRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  titleBlock: { flex: 1, gap: spacing.xs },
  name: { fontSize: 20, fontWeight: '700', color: colors.text },
  maker: { fontSize: 14, color: colors.textMuted },
  controlCard: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.lg, gap: spacing.lg },
  control: { flex: 1, gap: spacing.sm },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.borderLight },
  picker: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pickerText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  sectionTitle: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text },
  noteInput: { minHeight: 72, alignItems: 'flex-start' },
  paintsSection: { gap: spacing.md },
  paintsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addLink: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textPlaceholder },
});
