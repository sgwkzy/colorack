// components/KitDetailModal.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, type ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { IconChevronDown, IconChevronLeft, IconEdit, IconTrash, IconX } from '@tabler/icons-react-native';
import { useAnimatedRef } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  addKitColor,
  addKitPhoto,
  deleteKit,
  getDB,
  getKitColors,
  getKitDetail,
  getKitPhotos,
  getOwnedCountMap,
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
import { useAndroidBack } from '../lib/androidBack';
import { t } from '../lib/i18n';
import { useModalLock } from '../lib/modalLock';
import { spacing, useTheme } from '../lib/theme';
import { makeStyles } from './KitDetail/styles';
import ActionSheet from './ActionSheet';
import ClearableInput from './ClearableInput';
import KitUsedColorsPanel, { type UsedColorRepository } from './KitUsedColorsPanel';
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

export function parseKitPrice(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

interface Props {
  visible: boolean;
  kitId: number | null;
  onClose: () => void;
  onChanged?: () => void;
}

export default function KitDetailModal({ visible, kitId, onClose, onChanged }: Props) {
  useModalLock(visible);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const loadVersionRef = useRef(0);
  const [detail, setDetail] = useState<KitDetail | null>(null);
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
  const [detailTab, setDetailTab] = useState<'details' | 'colors'>('details');
  const [editMode, setEditMode] = useState(false);
  const [childOverlayOpen, setChildOverlayOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const scrollRef = useAnimatedRef<ScrollView>();
  const childRequestCloseRef = useRef<() => void>(() => {});
  const usedColorRepository = useMemo<UsedColorRepository>(() => {
    const usedKitId = detail?.id ?? 0;
    return {
      load: () => getKitColors(usedKitId),
      add: (name, note, paints) => addKitColor(usedKitId, name, note, paints),
      update: (colorId, name, note, paints) => updateKitColor(colorId, name, note, paints),
      remove: removeKitColor,
      reorder: reorderKitColors,
    };
  }, [detail?.id]);

  const dateLabel = (value: string | null) => (value ? value.slice(0, 16) : t('unknown'));

  // seedEditFields は初回表示と明示的な再試行だけ true にする。1フィールドの onBlur 保存の
  // あとに全フィールドを DB 値で再設定すると、まだ保存されていない別フィールドの
  // 入力中テキストが警告なく消える(例: 名前を編集して即メーカー欄に入力した場合)。
  const load = useCallback(async (seedEditFields = false): Promise<boolean> => {
    if (kitId == null) return false;
    const loadVersion = ++loadVersionRef.current;
    if (seedEditFields) setLoadState('loading');
    try {
      const [row, photoRows, owned] = await Promise.all([
        getKitDetail(kitId), getKitPhotos(kitId), getOwnedCountMap(),
      ]);
      if (loadVersion !== loadVersionRef.current) return false;
      setDetail(row);
      setPhotos(photoRows);
      setOwnedMap(owned);
      if (seedEditFields) {
        setName(row?.name ?? '');
        setMaker(row?.maker ?? '');
        setScale(row?.scale ?? '');
        setPrice(row?.price != null ? String(row.price) : '');
        setNote(row?.note ?? '');
        setSeries(row?.series ?? '');
        setCategory(row?.category ?? '');
      }
      setLoadState('ready');
      return true;
    } catch (error) {
      if (loadVersion !== loadVersionRef.current) return false;
      console.error('KitDetailModal: failed to load kit', error);
      if (seedEditFields) setLoadState('error');
      else Alert.alert(t('error'), t('loadFailed'));
      return false;
    }
  }, [kitId]);

  useEffect(() => {
    if (visible && kitId != null) {
      void load(true);
      getDB().getAllAsync<Box>('SELECT id, name FROM kit_boxes ORDER BY sort_order, id').then(setBoxes);
    } else {
      loadVersionRef.current += 1;
      setLoadState('loading');
      setDetail(null);
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
      setDetailTab('details');
      setEditMode(false);
      setViewerOpen(false);
      setChildOverlayOpen(false);
    }
  }, [visible, load]);

  const reportSaveFailure = (error: unknown) => {
    console.error('KitDetailModal: failed to save kit', error);
    Alert.alert(t('error'), t('saveFailed'));
  };

  const showRequiredFieldError = (label: string) => {
    Alert.alert(t('inputError'), label);
  };

  const validateFields = () => {
    if (name.trim() === '') {
      showRequiredFieldError(t('name'));
      return false;
    }
    if (maker.trim() === '') {
      showRequiredFieldError(t('maker'));
      return false;
    }
    if (parseKitPrice(price) === undefined) {
      Alert.alert(t('price'), t('invalidPrice'));
      return false;
    }
    return true;
  };

  const persist = async (update: () => Promise<void>) => {
    try {
      await update();
      await load();
      onChanged?.();
    } catch (error) {
      reportSaveFailure(error);
    }
  };

  const saveName = async () => {
    if (!detail) return;
    const trimmed = name.trim();
    if (trimmed === '') { showRequiredFieldError(t('name')); return; }
    if (trimmed === detail.name) return;
    await persist(() => updateKitName(detail.id, trimmed));
  };

  const saveMaker = async () => {
    if (!detail) return;
    const trimmed = maker.trim();
    if (trimmed === '') { showRequiredFieldError(t('maker')); return; }
    if (trimmed === detail.maker) return;
    await persist(() => updateKitMaker(detail.id, trimmed));
  };

  const saveScale = async () => {
    if (!detail) return;
    if (scale === (detail.scale ?? '')) return;
    await persist(() => updateKitScale(detail.id, scale));
  };

  const savePrice = async () => {
    if (!detail) return;
    const currentPrice = detail.price != null ? String(detail.price) : '';
    if (parseKitPrice(price) === undefined) { Alert.alert(t('price'), t('invalidPrice')); return; }
    if (price === currentPrice) return;
    await persist(() => updateKitPrice(detail.id, price));
  };

  const saveNote = async () => {
    if (!detail) return;
    if (note === (detail.note ?? '')) return;
    await persist(() => updateKitNote(detail.id, note));
  };

  const saveSeries = async () => {
    if (!detail) return;
    if (series === (detail.series ?? '')) return;
    await persist(() => updateKitSeries(detail.id, series));
  };

  const saveCategory = async () => {
    if (!detail) return;
    if (category === (detail.category ?? '')) return;
    await persist(() => updateKitCategory(detail.id, category));
  };

  const flushPendingFields = async (): Promise<boolean> => {
    if (!detail) return true;
    if (!validateFields()) return false;
    try {
      const trimmedName = name.trim();
      if (trimmedName !== detail.name) { await updateKitName(detail.id, trimmedName); onChanged?.(); }
      const trimmedMaker = maker.trim();
      if (trimmedMaker !== detail.maker) { await updateKitMaker(detail.id, trimmedMaker); onChanged?.(); }
      if (scale !== (detail.scale ?? '')) { await updateKitScale(detail.id, scale); onChanged?.(); }
      const currentPrice = detail.price != null ? String(detail.price) : '';
      if (price !== currentPrice) { await updateKitPrice(detail.id, price); onChanged?.(); }
      if (note !== (detail.note ?? '')) { await updateKitNote(detail.id, note); onChanged?.(); }
      if (series !== (detail.series ?? '')) { await updateKitSeries(detail.id, series); onChanged?.(); }
      if (category !== (detail.category ?? '')) { await updateKitCategory(detail.id, category); onChanged?.(); }
      return true;
    } catch (error) {
      reportSaveFailure(error);
      return false;
    }
  };

  const exitEditMode = async () => {
    if (!(await flushPendingFields())) return;
    if (!(await load())) return;
    setEditMode(false);
  };

  const closeAfterSavingFields = async () => {
    if (editMode) { await exitEditMode(); return; }
    if (!(await flushPendingFields())) return;
    onClose();
  };

  const closeModal = async () => {
    if (!(await flushPendingFields())) return;
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
  useAndroidBack(visible && !viewerOpen, () => {
    if (childOverlayOpen) childRequestCloseRef.current();
    else void closeAfterSavingFields();
  });

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
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('close')} onPress={closeModal} style={styles.headerButton}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>

          {loadState === 'loading' ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : loadState === 'error' ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
              <Text accessibilityRole="alert" style={styles.empty}>{t('loadFailed')}</Text>
              <TouchableOpacity
                onPress={() => { void load(true); }}
                accessibilityRole="button"
                accessibilityLabel={t('retry')}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xl }}
              >
                <Text style={{ color: colors.primaryText, fontWeight: '700' }}>{t('retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : !detail ? (
            <Text style={styles.empty}>{t('noResults')}</Text>
          ) : (
            <SwipeDownScrollView ref={scrollRef} style={styles.scroll} onClose={closeAfterSavingFields} closeEnabled={!viewerOpen && !childOverlayOpen} contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
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
                            <TouchableOpacity onPress={() => { setDetailTab('details'); setEditMode(true); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('enterEditMode')}>
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

              {!editMode ? <View style={styles.tabBar}>
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
              </View> : null}

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
              ) : null}
              <KitUsedColorsPanel
                active={detailTab === 'colors'}
                repository={usedColorRepository}
                ownedMap={ownedMap}
                scrollableRef={scrollRef}
                requestCloseRef={childRequestCloseRef}
                onOverlayChange={setChildOverlayOpen}
              />
            </SwipeDownScrollView>
          )}

          {editMode ? (
            <SafeAreaView edges={['bottom']} style={styles.editBar}>
              <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete}>
                <Text style={styles.deleteBtnText}>{t('delete')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveEditBtn} onPress={exitEditMode}>
                <Text style={styles.saveEditBtnText}>{t('save')}</Text>
              </TouchableOpacity>
            </SafeAreaView>
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
        </SafeAreaView>
        </SwipeBack>
      </SafeAreaProvider>
    </Modal>
  );
}
