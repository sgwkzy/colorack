// components/KitDetailModal.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconChevronDown, IconChevronLeft, IconChevronUp, IconEdit, IconPlus, IconShoppingCartPlus, IconTrash, IconX } from '@tabler/icons-react-native';
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
  updateKitColor,
  updateKitMaker,
  updateKitName,
  updateKitNote,
  updateKitPrice,
  updateKitScale,
  updateKitSeries,
} from '../lib/db';
import { deleteKitPhoto } from '../lib/kitPhoto';
import { draftFromSummary, normalizeDraftPaints } from '../lib/colorMixDraft';
import { t } from '../lib/i18n';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
import { makeStyles } from './KitDetail/styles';
import ActionSheet from './ActionSheet';
import ClearableInput from './ClearableInput';
import KitColorComposerModal from './KitColorComposerModal';
import KitColorRow from './KitColorRow';
import ColorMixDetailModal from './ColorMixDetailModal';
import ColorMixEditorModal from './ColorMixEditorModal';
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
  const [selectedColor, setSelectedColor] = useState<KitColorSummary | null>(null);
  const [colorDetailOpen, setColorDetailOpen] = useState(false);
  const [editingColor, setEditingColor] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [inWishlist, setInWishlist] = useState(false);
  const childRequestCloseRef = useRef<() => void>(() => {});

  const dateLabel = (value: string | null) => (value ? value.slice(0, 16) : t('unknown'));

  // seedEditFields はモーダルを開くときだけ true にする。1フィールドの onBlur 保存の
  // あとに全フィールドを DB 値で再設定すると、まだ保存されていない別フィールドの
  // 入力中テキストが警告なく消える(例: 名前を編集して即メーカー欄に入力した場合)。
  const load = useCallback(async (seedEditFields = false) => {
    if (kitId == null) return;
    const [row, colorRows, photoRows, owned, wishlistRow] = await Promise.all([
      getKitDetail(kitId), getKitColors(kitId), getKitPhotos(kitId), getOwnedCountMap(),
      getDB().getFirstAsync<{ id: number }>('SELECT id FROM kit_lists WHERE kit_id = ?', [kitId]),
    ]);
    setDetail(row);
    setKitColors(colorRows);
    setPhotos(photoRows);
    setOwnedMap(owned);
    setInWishlist(!!wishlistRow);
    if (seedEditFields) {
      setName(row?.name ?? '');
      setMaker(row?.maker ?? '');
      setScale(row?.scale ?? '');
      setPrice(row?.price != null ? String(row.price) : '');
      setNote(row?.note ?? '');
      setSeries(row?.series ?? '');
      setCategory(row?.category ?? '');
    }
  }, [kitId]);

  useEffect(() => {
    if (visible) {
      load(true);
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
      setInWishlist(false);
      setSelectedColor(null);
      setColorDetailOpen(false);
      setEditingColor(false);
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
    await load();
    onChanged?.();
  };

  const toggleWishlist = async () => {
    if (!detail) return;
    if (inWishlist) await getDB().runAsync('DELETE FROM kit_lists WHERE kit_id = ?', [detail.id]);
    else await getDB().runAsync('INSERT OR IGNORE INTO kit_lists (kit_id) VALUES (?)', [detail.id]);
    setInWishlist((current) => !current);
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
    // ponytail: 共有Storage実体は即時削除せず、参照を確認できるサーバー側GCで回収する。
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
    try {
      await removeKitColor(kitColorId);
      setKitColors((current) => current.filter((color) => color.id !== kitColorId));
      setColorDetailOpen(false);
      setSelectedColor(null);
      await load();
    } catch (error) {
      console.error('KitDetailModal: failed to remove kit color', error);
      Alert.alert(t('error'), t('saveFailed'));
    }
  };

  const confirmRemoveColor = (color: KitColorSummary) => {
    Alert.alert(color.name || t('mixResult'), t('deleteMixConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => removeColor(color.id) },
    ]);
  };

  const saveColor = async (draft: ReturnType<typeof draftFromSummary>) => {
    if (!selectedColor) return;
    await updateKitColor(
      selectedColor.id,
      draft.name.trim() || null,
      draft.note.trim() || null,
      normalizeDraftPaints(draft.paints),
    );
    await load();
    setEditingColor(false);
  };

  const moveColor = async (kitColorId: number, direction: -1 | 1) => {
    const index = kitColors.findIndex((c) => c.id === kitColorId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= kitColors.length) return;
    const next = [...kitColors];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    try {
      await reorderKitColors(next.map((c) => c.id));
      setKitColors(next);
      await load();
    } catch (error) {
      console.error('KitDetailModal: failed to reorder kit colors', error);
      Alert.alert(t('error'), t('saveFailed'));
    }
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
  const childOverlayOpen = pickerOpen || editingColor;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={childOverlayOpen ? () => childRequestCloseRef.current() : closeAfterSavingFields}>
      <SafeAreaProvider>
        <SwipeBack enabled={visible && !viewerOpen && !childOverlayOpen} onBack={closeAfterSavingFields}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <SwipeDownHeader onClose={closeAfterSavingFields} enabled={!viewerOpen && !childOverlayOpen}>
            <View style={styles.header}>
              {editMode ? (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('editKitTitle')} onPress={exitEditMode} style={styles.backBtn}>
                  <IconChevronLeft color={colors.primary} size={22} />
                  <Text style={styles.title}>{t('editKitTitle')}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.title}>{t('kitDetailTitle')}</Text>
              )}
              {!editMode ? (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('close')} onPress={closeAfterSavingFields} style={styles.headerButton}>
                  <IconX color={colors.text} size={24} />
                </TouchableOpacity>
              ) : null}
            </View>
          </SwipeDownHeader>

          {!detail ? (
            <Text style={styles.empty}>{t('noResults')}</Text>
          ) : (
            <SwipeDownScrollView style={styles.scroll} onClose={closeAfterSavingFields} closeEnabled={!viewerOpen && !childOverlayOpen} contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
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
                      <View style={styles.nameActions}>
                        <TouchableOpacity onPress={toggleWishlist} hitSlop={8} accessibilityRole="button" accessibilityLabel={t(inWishlist ? 'removeFromKitWishlist' : 'addToKitWishlist')}>
                          <IconShoppingCartPlus color={inWishlist ? colors.primary : colors.textMuted} size={20} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setEditMode(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('enterEditMode')}>
                          <IconEdit color={colors.textMuted} size={20} />
                        </TouchableOpacity>
                      </View>
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
                  accessibilityRole="tab"
                  accessibilityState={{ selected: detailTab === 'details' }}
                  accessibilityLabel={t('detailInfo')}
                  style={[styles.tabBtn, detailTab === 'details' && styles.tabBtnActive]}
                  onPress={() => setDetailTab('details')}
                >
                  <Text style={[styles.tabText, detailTab === 'details' && styles.tabTextActive]}>{t('detailInfo')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="tab"
                  accessibilityState={{ selected: detailTab === 'colors' }}
                  accessibilityLabel={t('usedColorsTab')}
                  style={[styles.tabBtn, detailTab === 'colors' && styles.tabBtnActive]}
                  onPress={() => setDetailTab('colors')}
                >
                  <Text style={[styles.tabText, detailTab === 'colors' && styles.tabTextActive]}>{t('usedColorsTab')}</Text>
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
                <View style={styles.paintsSection}>
                  <View style={styles.paintsHeader}>
                    <Text style={styles.sectionTitle}>{t('kitUsedColors')}</Text>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={t('addUsedColor')}
                      onPress={() => setPickerOpen(true)}
                      style={styles.addColorButton}
                    >
                      <IconPlus color={colors.primary} size={18} />
                      <Text style={styles.addLink}>{t('addUsedColor')}</Text>
                    </TouchableOpacity>
                  </View>
                  {kitColors.length === 0 ? <Text style={styles.empty}>{t('emptyKitColors')}</Text> : null}
                  {kitColors.map((color, index) => {
                    const colorLabel = color.name?.trim() || color.paints[0]?.code || t('mixResult');
                    return (
                    <View key={color.id} style={styles.colorItem}>
                      <KitColorRow
                        color={color}
                        ownedMap={ownedMap}
                        onPress={() => { setSelectedColor(color); setColorDetailOpen(true); }}
                      />
                      {editMode ? (
                        <View style={styles.colorActions}>
                          <TouchableOpacity
                            style={styles.colorAction}
                            onPress={() => moveColor(color.id, -1)}
                            disabled={index === 0}
                            accessibilityRole="button"
                            accessibilityLabel={`${colorLabel} ${t('moveUp')}`}
                            accessibilityState={{ disabled: index === 0 }}
                          >
                            <IconChevronUp color={colors.text} size={20} opacity={index === 0 ? 0.35 : 1} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.colorAction}
                            onPress={() => moveColor(color.id, 1)}
                            disabled={index === kitColors.length - 1}
                            accessibilityRole="button"
                            accessibilityLabel={`${colorLabel} ${t('moveDown')}`}
                            accessibilityState={{ disabled: index === kitColors.length - 1 }}
                          >
                            <IconChevronDown color={colors.text} size={20} opacity={index === kitColors.length - 1 ? 0.35 : 1} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.colorAction, styles.colorDelete]}
                            onPress={() => confirmRemoveColor(color)}
                            accessibilityRole="button"
                            accessibilityLabel={`${colorLabel} ${t('delete')}`}
                          >
                            <IconTrash color={colors.danger} size={20} />
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                    );
                  })}
                </View>
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
              requestCloseRef={childRequestCloseRef}
              onClose={() => setPickerOpen(false)}
              onAdded={load}
            />
          ) : null}
          <ColorMixDetailModal
            visible={colorDetailOpen}
            color={selectedColor}
            editable
            ownedMap={ownedMap}
            onEdit={() => { setColorDetailOpen(false); setEditingColor(true); }}
            onDelete={() => selectedColor && confirmRemoveColor(selectedColor)}
            onClose={() => setColorDetailOpen(false)}
          />
          <ColorMixEditorModal
            visible={editingColor}
            embedded
            embeddedSafeArea
            requestCloseRef={childRequestCloseRef}
            title={t('editMix')}
            initialDraft={draftFromSummary(selectedColor)}
            onSave={saveColor}
            onClose={() => setEditingColor(false)}
          />
        </SafeAreaView>
        </SwipeBack>
      </SafeAreaProvider>
    </Modal>
  );
}
