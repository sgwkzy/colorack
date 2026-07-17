// components/KitDetailModal.tsx
import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconChevronDown, IconChevronLeft, IconEdit, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  addKitPhoto,
  deleteKit,
  getDB,
  getKitColors,
  getKitDetail,
  getKitPhotos,
  getOwnedCountMap,
  KitColorSummary,
  KitDetail,
  KitPhoto,
  KitStatus,
  removeKitColor,
  removeKitPhoto,
  reorderKitColors,
  reorderKitPhotos,
  setKitStatus,
  updateKitBox,
  updateKitCategory,
  updateKitColorName,
  updateKitMaker,
  updateKitName,
  updateKitNote,
  updateKitPrice,
  updateKitScale,
  updateKitSeries,
} from '../lib/db';
import { deleteKitPhoto } from '../lib/kitPhoto';
import { maybeRequestStoreReview } from '../lib/reviewPrompt';
import { t } from '../lib/i18n';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
import ActionSheet from './ActionSheet';
import ClearableInput from './ClearableInput';
import KitColorComposerModal from './KitColorComposerModal';
import KitColorRow from './KitColorRow';
import KitPhotoGrid from './KitPhotoGrid';
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
  const [kitColors, setKitColors] = useState<KitColorSummary[]>([]);
  const [ownedMap, setOwnedMap] = useState<Map<number, number>>(new Map());
  const [photos, setPhotos] = useState<KitPhoto[]>([]);
  const [name, setName] = useState('');
  const [maker, setMaker] = useState('');
  const [scale, setScale] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [series, setSeries] = useState('');
  const [category, setCategory] = useState('');
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [boxPickerOpen, setBoxPickerOpen] = useState(false);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<'details' | 'colors'>('details');
  // 使用する色タブのツールチップは1つだけ開けるよう、ここで一元管理する。
  const [openTooltipKey, setOpenTooltipKey] = useState<string | null>(null);
  const toggleTooltip = (key: string) => setOpenTooltipKey((current) => (current === key ? null : key));
  const [editMode, setEditMode] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  const dateLabel = (value: string | null) => (value ? value.slice(0, 16) : t('unknown'));

  const load = useCallback(async () => {
    if (kitId == null) return;
    const [row, colorRows, photoRows, owned] = await Promise.all([getKitDetail(kitId), getKitColors(kitId), getKitPhotos(kitId), getOwnedCountMap()]);
    setDetail(row);
    setKitColors(colorRows);
    setPhotos(photoRows);
    setOwnedMap(owned);
    setName(row?.name ?? '');
    setMaker(row?.maker ?? '');
    setScale(row?.scale ?? '');
    setPrice(row?.price != null ? String(row.price) : '');
    setNote(row?.note ?? '');
    setSeries(row?.series ?? '');
    setCategory(row?.category ?? '');
  }, [kitId]);

  useEffect(() => {
    if (visible) {
      load();
      getDB().getAllAsync<Box>('SELECT id, name FROM kit_boxes ORDER BY sort_order, id').then(setBoxes);
    } else {
      setDetail(null);
      setKitColors([]);
      setOwnedMap(new Map());
      setPhotos([]);
      setName('');
      setMaker('');
      setScale('');
      setPrice('');
      setNote('');
      setSeries('');
      setCategory('');
      setBoxPickerOpen(false);
      setStatusPickerOpen(false);
      setPickerOpen(false);
      setDetailTab('details');
      setEditMode(false);
      setViewerOpen(false);
      setOpenTooltipKey(null);
    }
  }, [visible, load]);

  const saveName = async () => {
    if (!detail) return;
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === detail.name) return;
    await updateKitName(detail.id, trimmed);
    await load();
    onChanged?.();
  };

  const saveMaker = async () => {
    if (!detail) return;
    const trimmed = maker.trim();
    if (trimmed === '' || trimmed === detail.maker) return;
    await updateKitMaker(detail.id, trimmed);
    await load();
    onChanged?.();
  };

  const saveScale = async () => {
    if (!detail) return;
    if (scale === (detail.scale ?? '')) return;
    await updateKitScale(detail.id, scale);
    await load();
    onChanged?.();
  };

  const savePrice = async () => {
    if (!detail) return;
    const currentPrice = detail.price != null ? String(detail.price) : '';
    if (price === currentPrice) return;
    await updateKitPrice(detail.id, price);
    await load();
    onChanged?.();
  };

  const saveNote = async () => {
    if (!detail) return;
    if (note === (detail.note ?? '')) return;
    await updateKitNote(detail.id, note);
    await load();
    onChanged?.();
  };

  const saveSeries = async () => {
    if (!detail) return;
    if (series === (detail.series ?? '')) return;
    await updateKitSeries(detail.id, series);
    await load();
    onChanged?.();
  };

  const saveCategory = async () => {
    if (!detail) return;
    if (category === (detail.category ?? '')) return;
    await updateKitCategory(detail.id, category);
    await load();
    onChanged?.();
  };

  const flushPendingFields = async () => {
    if (!detail) return;
    const trimmedName = name.trim();
    if (trimmedName !== '' && trimmedName !== detail.name) { await updateKitName(detail.id, trimmedName); onChanged?.(); }
    const trimmedMaker = maker.trim();
    if (trimmedMaker !== '' && trimmedMaker !== detail.maker) { await updateKitMaker(detail.id, trimmedMaker); onChanged?.(); }
    if (scale !== (detail.scale ?? '')) { await updateKitScale(detail.id, scale); onChanged?.(); }
    const currentPrice = detail.price != null ? String(detail.price) : '';
    if (price !== currentPrice) { await updateKitPrice(detail.id, price); onChanged?.(); }
    if (note !== (detail.note ?? '')) { await updateKitNote(detail.id, note); onChanged?.(); }
    if (series !== (detail.series ?? '')) { await updateKitSeries(detail.id, series); onChanged?.(); }
    if (category !== (detail.category ?? '')) { await updateKitCategory(detail.id, category); onChanged?.(); }
  };

  const closeAfterSavingFields = async () => {
    await flushPendingFields();
    onClose();
  };

  const exitEditMode = async () => {
    await flushPendingFields();
    await load();
    setEditMode(false);
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
    if (status === 'completed') void maybeRequestStoreReview();
    await load();
    onChanged?.();
  };

  const addPhoto = async (uri: string) => {
    if (!detail) return;
    await addKitPhoto(detail.id, uri);
    await load();
    onChanged?.();
  };

  const removePhoto = async (photoId: number, uri: string) => {
    await removeKitPhoto(photoId);
    await deleteKitPhoto(uri);
    await load();
    onChanged?.();
  };

  const movePhoto = async (photoId: number, direction: -1 | 1) => {
    const index = photos.findIndex((p) => p.id === photoId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= photos.length) return;
    const next = [...photos];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    await reorderKitPhotos(next.map((p) => p.id));
    await load();
    onChanged?.();
  };

  const removeColor = async (kitColorId: number) => {
    await removeKitColor(kitColorId);
    await load();
  };

  const changeColorName = async (kitColorId: number, next: string) => {
    await updateKitColorName(kitColorId, next);
    await load();
  };

  const moveColor = async (kitColorId: number, direction: -1 | 1) => {
    const index = kitColors.findIndex((c) => c.id === kitColorId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= kitColors.length) return;
    const next = [...kitColors];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    await reorderKitColors(next.map((c) => c.id));
    await load();
  };

  const confirmDelete = () => {
    if (!detail) return;
    Alert.alert(detail.name, t('deleteKitConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'), style: 'destructive',
        onPress: async () => {
          await deleteKit(detail.id);
          for (const photo of photos) await deleteKitPhoto(photo.uri);
          onChanged?.();
          onClose();
        },
      },
    ]);
  };

  const boxName = boxes.find((b) => b.id === detail?.box_id)?.name ?? t('unassigned');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={closeAfterSavingFields}>
      <SafeAreaProvider>
        <SwipeBack enabled={visible && !viewerOpen} onBack={closeAfterSavingFields}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <SwipeDownHeader onClose={closeAfterSavingFields} enabled={!viewerOpen}>
            <View style={styles.header}>
              {editMode ? (
                <TouchableOpacity onPress={exitEditMode} hitSlop={8} style={styles.backBtn}>
                  <IconChevronLeft color={colors.primary} size={22} />
                  <Text style={styles.title}>{t('editKitTitle')}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.title}>{t('kitDetailTitle')}</Text>
              )}
              {!editMode ? (
                <TouchableOpacity onPress={closeAfterSavingFields} hitSlop={8} accessibilityLabel={t('close')}>
                  <IconX color={colors.text} size={24} />
                </TouchableOpacity>
              ) : null}
            </View>
          </SwipeDownHeader>

          {!detail ? (
            <Text style={styles.empty}>{t('noResults')}</Text>
          ) : (
            <SwipeDownScrollView style={styles.scroll} onClose={closeAfterSavingFields} closeEnabled={!viewerOpen} contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
              <View style={styles.titleBlock}>
                {editMode ? (
                  <>
                    <ClearableInput style={styles.nameEditInput} value={name} onChangeText={setName} onBlur={saveName} placeholder={t('name')} />
                    <View style={styles.field}>
                      <Text style={styles.sectionTitle}>{t('maker')}</Text>
                      <ClearableInput style={styles.input} value={maker} onChangeText={setMaker} onBlur={saveMaker} placeholder={t('maker')} />
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.sectionTitle}>{t('scale')}</Text>
                      <ClearableInput style={styles.input} value={scale} onChangeText={setScale} onBlur={saveScale} placeholder="1/144" />
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.nameRow}>
                      <Text style={styles.name}>{detail.name}</Text>
                      <TouchableOpacity onPress={() => setEditMode(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('enterEditMode')}>
                        <IconEdit color={colors.textMuted} size={20} />
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.maker}>{detail.maker}{detail.scale ? ` · ${detail.scale}` : ''}</Text>
                  </>
                )}
              </View>
              <KitPhotoGrid
                photos={photos.map((p) => ({ key: p.id, uri: p.uri }))}
                editable={editMode}
                disableTapPreview={editMode}
                onViewerChange={setViewerOpen}
                onAdd={addPhoto}
                onRemove={(key) => {
                  const photo = photos.find((p) => p.id === key);
                  if (photo) removePhoto(photo.id, photo.uri);
                }}
                onMove={(key, direction) => movePhoto(key as number, direction)}
              />

              <View style={styles.tabBar}>
                <TouchableOpacity
                  style={[styles.tabBtn, detailTab === 'details' && styles.tabBtnActive]}
                  onPress={() => setDetailTab('details')}
                >
                  <Text style={[styles.tabText, detailTab === 'details' && styles.tabTextActive]}>{t('detailInfo')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tabBtn, detailTab === 'colors' && styles.tabBtnActive]}
                  onPress={() => setDetailTab('colors')}
                >
                  <Text style={[styles.tabText, detailTab === 'colors' && styles.tabTextActive]}>{t('colorInfo')}</Text>
                </TouchableOpacity>
              </View>

              {detailTab === 'details' ? (
                <>
                  <View style={styles.card}>
                    <View style={styles.fieldRow}>
                      <View style={[styles.field, styles.fieldHalf]}>
                        <Text style={styles.sectionTitle}>{t('series')}</Text>
                        {editMode ? (
                          <ClearableInput style={styles.input} value={series} onChangeText={setSeries} onBlur={saveSeries} />
                        ) : (
                          <Text style={styles.pickerText}>{series || t('unknown')}</Text>
                        )}
                      </View>
                      <View style={[styles.field, styles.fieldHalf]}>
                        <Text style={styles.sectionTitle}>{t('category')}</Text>
                        {editMode ? (
                          <ClearableInput style={styles.input} value={category} onChangeText={setCategory} onBlur={saveCategory} />
                        ) : (
                          <Text style={styles.pickerText}>{category || t('unknown')}</Text>
                        )}
                      </View>
                    </View>
                    <View style={styles.fieldRow}>
                      <View style={[styles.field, styles.fieldHalf]}>
                        <Text style={styles.sectionTitle}>{t('price')}</Text>
                        {editMode ? (
                          <ClearableInput style={styles.input} value={price} onChangeText={setPrice} onBlur={savePrice} keyboardType="numeric" placeholder="0" />
                        ) : (
                          <Text style={styles.pickerText}>{detail.price != null ? detail.price.toLocaleString() : t('unknown')}</Text>
                        )}
                      </View>
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

                  <View style={styles.controlCard}>
                    <View style={styles.control}>
                      <Text style={styles.sectionTitle}>{t('addedAt')}</Text>
                      <Text style={styles.pickerText}>{dateLabel(detail.added_at)}</Text>
                    </View>
                    <View style={styles.divider} />
                    <View style={styles.control}>
                      <Text style={styles.sectionTitle}>{t('lastUpdatedAt')}</Text>
                      <Text style={styles.pickerText}>{dateLabel(detail.status_changed_at)}</Text>
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
                </>
              ) : (
                // 色以外(見出し・パディング部分)をタップした時にもツールチップを閉じたいので、
                // セクション全体をPressableにする。子のTouchableOpacity/KitColorRow内のタップは
                // それぞれが先に消費するため、ここのonPressは「何もつかまなかった時」だけ発火する。
                <Pressable style={styles.paintsSection} onPress={() => setOpenTooltipKey(null)}>
                  <View style={styles.paintsHeader}>
                    <Text style={styles.sectionTitle}>{t('usedPaints')}</Text>
                    <TouchableOpacity onPress={() => setPickerOpen(true)}>
                      <Text style={styles.addLink}>{t('addColor')}</Text>
                    </TouchableOpacity>
                  </View>
                  {kitColors.map((color, index) => (
                    <KitColorRow
                      key={color.id}
                      color={color}
                      editable={editMode}
                      ownedMap={ownedMap}
                      canMoveLeft={index > 0}
                      canMoveRight={index < kitColors.length - 1}
                      onNameChange={(next) => changeColorName(color.id, next)}
                      onRemove={() => removeColor(color.id)}
                      onMove={(direction) => moveColor(color.id, direction)}
                      openTooltipKey={openTooltipKey}
                      onToggleTooltip={toggleTooltip}
                    />
                  ))}
                </Pressable>
              )}
            </SwipeDownScrollView>
          )}

          {editMode ? (
            <View style={styles.editBar}>
              <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete}>
                <Text style={styles.deleteBtnText}>{t('delete')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveEditBtn} onPress={exitEditMode}>
                <Text style={styles.saveEditBtnText}>{t('save')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

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
          {detail ? (
            <KitColorComposerModal
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
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  title: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, gap: spacing.lg },
  titleBlock: { gap: spacing.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  name: { fontSize: 20, fontWeight: '700', color: colors.text },
  nameEditInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text, fontSize: 20, fontWeight: '700' },
  maker: { fontSize: 14, color: colors.textMuted },
  controlCard: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.lg, gap: spacing.lg },
  control: { flex: 1, gap: spacing.sm },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.borderLight },
  picker: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pickerText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  field: { gap: spacing.xs },
  fieldRow: { flexDirection: 'row', gap: spacing.lg },
  fieldHalf: { flex: 1 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  tabBtn: { flex: 1, padding: spacing.md, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabText: { fontSize: 13, color: colors.textPlaceholder },
  tabTextActive: { color: colors.primary, fontWeight: 'bold' },
  sectionTitle: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text },
  noteInput: { minHeight: 72, alignItems: 'flex-start' },
  paintsSection: { gap: spacing.md },
  paintsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addLink: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textPlaceholder },
  editBar: { flexDirection: 'row', gap: spacing.md, padding: spacing.xl, borderTopWidth: 1, borderTopColor: colors.borderLight },
  deleteBtn: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md },
  deleteBtnText: { color: colors.danger, fontWeight: '700', fontSize: 16 },
  saveEditBtn: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: radius.md },
  saveEditBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
});
