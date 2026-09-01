import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Text, TouchableOpacity, View } from 'react-native';
import { IconBox, IconChevronLeft, IconEdit, IconTrash, IconX } from '@tabler/icons-react-native';
import { useAnimatedRef } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  addKitWishlistColor,
  getKitWishlistColors,
  getKitWishlistItem,
  getKitWishlistPhotos,
  getOwnedCountMap,
  type KitWishlistItem,
  type KitWishlistPhoto,
  removeKitWishlistColor,
  reorderKitWishlistColors,
  saveKitWishlistItem,
  updateKitWishlistColor,
} from '../lib/db';
import { deleteKitPhoto } from '../lib/kitPhoto';
import { useAndroidBack } from '../lib/androidBack';
import { t, useLocale } from '../lib/i18n';
import { useModalLock } from '../lib/modalLock';
import { useTheme } from '../lib/theme';
import type { ScrollView } from 'react-native';
import { isKitFormDirty, type KitFormValues } from './AddKitModal';
import ClearableInput from './ClearableInput';
import KitPhotoGrid from './KitPhotoGrid';
import KitUsedColorsPanel, { KitUsedColorsOverlays, useKitUsedColorsController, type UsedColorRepository } from './KitUsedColorsPanel';
import SwipeBack from './SwipeBack';
import SwipeDownHeader from './SwipeDownHeader';
import SwipeDownScrollView from './SwipeDownScrollView';
import { makeStyles } from './KitWishlistDetail/styles';

interface KitWishlistDetailModalProps {
  visible: boolean;
  wishlistId: number | null;
  onClose(): void;
  onChanged(): void;
  onMove(item: KitWishlistItem): void;
  onDelete(item: KitWishlistItem): void;
}

type ValueRef<T> = { current: T };
type LatestRead<T> = { current: true; value: T } | { current: false };

export async function readLatestWishlistDetail<T>(
  versionRef: ValueRef<number>,
  read: () => Promise<T>,
): Promise<LatestRead<T>> {
  const version = ++versionRef.current;
  try {
    const value = await read();
    return version === versionRef.current ? { current: true, value } : { current: false };
  } catch (error) {
    if (version !== versionRef.current) return { current: false };
    throw error;
  }
}

export function handoffWishlistParentAction(
  platform: string,
  pendingActionRef: ValueRef<(() => void) | null>,
  closeModal: () => void,
  action: () => void,
) {
  if (platform === 'ios') {
    pendingActionRef.current = action;
    closeModal();
    return;
  }
  closeModal();
  action();
}

export function runPendingWishlistParentAction(pendingActionRef: ValueRef<(() => void) | null>) {
  const action = pendingActionRef.current;
  pendingActionRef.current = null;
  action?.();
}

export async function discardWishlistDraftPhotos(
  draftPhotoUris: Set<string>,
  removePhotos: (uris: readonly string[]) => Promise<void>,
  closeModal: () => void,
) {
  await removePhotos([...draftPhotoUris]);
  draftPhotoUris.clear();
  closeModal();
}

export default function KitWishlistDetailModal({
  visible,
  wishlistId,
  onClose,
  onChanged,
  onMove,
  onDelete,
}: KitWishlistDetailModalProps) {
  useModalLock(visible);
  useLocale();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const loadVersionRef = useRef(0);
  const [item, setItem] = useState<KitWishlistItem | null>(null);
  const [ownedMap, setOwnedMap] = useState<Map<number, number>>(new Map());
  const [photos, setPhotos] = useState<KitWishlistPhoto[]>([]);
  const [name, setName] = useState('');
  const [maker, setMaker] = useState('');
  const [scale, setScale] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [series, setSeries] = useState('');
  const [category, setCategory] = useState('');
  const [detailTab, setDetailTab] = useState<'details' | 'colors'>('details');
  const [editMode, setEditMode] = useState(false);
  const [childOverlayOpen, setChildOverlayOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const scrollRef = useAnimatedRef<ScrollView>();
  const childRequestCloseRef = useRef<() => void>(() => {});
  const initialPhotoUrisRef = useRef(new Set<string>());
  const draftPhotoUrisRef = useRef(new Set<string>());
  const draftPhotoIdRef = useRef(-1);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const savingRef = useRef(false);

  const usedColorRepository = useMemo<UsedColorRepository>(() => {
    const candidateId = item?.id ?? 0;
    return {
      load: () => getKitWishlistColors(candidateId),
      add: (colorName, colorNote, paints) => addKitWishlistColor(candidateId, colorName, colorNote, paints),
      update: (colorId, colorName, colorNote, paints) => updateKitWishlistColor(candidateId, colorId, colorName, colorNote, paints),
      remove: (colorId) => removeKitWishlistColor(candidateId, colorId),
      reorder: (colorIds) => reorderKitWishlistColors(candidateId, colorIds),
    };
  }, [item?.id]);
  const usedColorsActive = Boolean(item) && detailTab === 'colors' && !editMode;
  const usedColorController = useKitUsedColorsController({
    active: usedColorsActive,
    repository: usedColorRepository,
    onOverlayChange: setChildOverlayOpen,
  });

  const seedFields = (nextItem: KitWishlistItem, nextPhotos: KitWishlistPhoto[]) => {
    setName(nextItem.name);
    setMaker(nextItem.maker);
    setScale(nextItem.scale ?? '');
    setPrice(nextItem.price != null ? String(nextItem.price) : '');
    setNote(nextItem.note ?? '');
    setSeries(nextItem.series ?? '');
    setCategory(nextItem.category ?? '');
    initialPhotoUrisRef.current = new Set(nextPhotos.map((photo) => photo.uri));
    draftPhotoUrisRef.current = new Set();
  };

  const load = useCallback(async (seedEditFields = false): Promise<boolean> => {
    if (wishlistId == null) return false;
    if (seedEditFields) setLoadState('loading');
    try {
      const result = await readLatestWishlistDetail(loadVersionRef, () => Promise.all([
        getKitWishlistItem(wishlistId), getKitWishlistPhotos(wishlistId), getOwnedCountMap(),
      ]));
      if (!result.current) return false;
      const [nextItem, nextPhotos, owned] = result.value;
      setItem(nextItem);
      setPhotos(nextPhotos);
      setOwnedMap(owned);
      if (seedEditFields && nextItem) seedFields(nextItem, nextPhotos);
      setLoadState('ready');
      return true;
    } catch (error) {
      console.error('KitWishlistDetailModal: failed to load candidate', error);
      if (seedEditFields) setLoadState('error');
      else Alert.alert(t('error'), t('loadFailed'));
      return false;
    }
  }, [wishlistId]);

  useEffect(() => {
    if (visible && wishlistId != null) {
      setEditMode(false);
      setDetailTab('details');
      void load(true);
      return;
    }
    loadVersionRef.current += 1;
    setLoadState('loading');
    setItem(null);
    setOwnedMap(new Map());
    setPhotos([]);
    setName('');
    setMaker('');
    setScale('');
    setPrice('');
    setNote('');
    setSeries('');
    setCategory('');
    setDetailTab('details');
    setEditMode(false);
    setChildOverlayOpen(false);
    setViewerOpen(false);
    setBusy(false);
    initialPhotoUrisRef.current = new Set();
    draftPhotoUrisRef.current = new Set();
  }, [load, visible, wishlistId]);

  const currentForm: KitFormValues = {
    name,
    maker,
    series,
    category,
    scale,
    price,
    note,
    photos: photos.map((photo) => photo.uri),
  };
  const initialEditForm: KitFormValues | undefined = item ? {
    name: item.name,
    maker: item.maker,
    series: item.series ?? '',
    category: item.category ?? '',
    scale: item.scale ?? '',
    price: item.price != null ? String(item.price) : '',
    note: item.note ?? '',
    photos: [...initialPhotoUrisRef.current],
  } : undefined;
  const dirty = isKitFormDirty(currentForm, initialEditForm);

  const removeDetachedCandidatePhotos = async (uris: readonly string[]) => {
    for (const uri of uris) {
      await deleteKitPhoto(uri).catch((error) =>
        console.error('KitWishlistDetailModal: failed to remove detached candidate photo', uri, error)
      );
    }
  };

  const parsePrice = (value: string): number | null | undefined => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  };

  const saveChanges = async () => {
    if (!item || savingRef.current) return;
    const normalizedPrice = parsePrice(price);
    if (name.trim() === '') { Alert.alert(t('inputError'), t('name')); return; }
    if (maker.trim() === '') { Alert.alert(t('inputError'), t('maker')); return; }
    if (normalizedPrice === undefined) { Alert.alert(t('price'), t('invalidPrice')); return; }
    savingRef.current = true;
    setBusy(true);
    try {
      const result = await saveKitWishlistItem(item.id, {
        name: name.trim(),
        maker: maker.trim(),
        series: series.trim() || null,
        category: category.trim() || null,
        scale: scale.trim() || null,
        price: normalizedPrice,
        note: note.trim() || null,
      }, photos.map((photo) => photo.uri));
      await removeDetachedCandidatePhotos(result.removedPhotoUris);
      draftPhotoUrisRef.current.clear();
      initialPhotoUrisRef.current = new Set(photos.map((photo) => photo.uri));
      await load();
      setEditMode(false);
      onChanged();
    } catch (error) {
      console.error('KitWishlistDetailModal: failed to save candidate', error);
      Alert.alert(t('error'), t('saveFailed'));
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  const discardChanges = useCallback(async () => {
    if (savingRef.current) return;
    try {
      await discardWishlistDraftPhotos(draftPhotoUrisRef.current, removeDetachedCandidatePhotos, onClose);
    } catch (error) {
      console.error('KitWishlistDetailModal: failed to discard candidate photos', error);
      Alert.alert(t('error'), t('saveFailed'));
    }
  }, [onClose]);

  const closeModal = useCallback(() => {
    if (!visible || savingRef.current) return;
    if (editMode && dirty) {
      Alert.alert(t('discardChangesConfirm'), '', [
        { text: t('cancel'), style: 'cancel' },
        { text: t('discard'), style: 'destructive', onPress: () => { void discardChanges(); } },
      ]);
      return;
    }
    if (editMode) {
      void discardChanges();
      return;
    }
    onClose();
  }, [dirty, discardChanges, editMode, onClose, visible]);

  const requestParentAction = (action: 'move' | 'delete') => {
    if (!item || editMode || savingRef.current) return;
    const currentItem = item;
    handoffWishlistParentAction(Platform.OS, pendingActionRef, onClose, () => {
      if (action === 'move') onMove(currentItem);
      else onDelete(currentItem);
    });
  };

  const handleDismiss = () => {
    runPendingWishlistParentAction(pendingActionRef);
  };

  useAndroidBack(visible && !viewerOpen, () => {
    if (childOverlayOpen) childRequestCloseRef.current();
    else closeModal();
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={childOverlayOpen ? () => childRequestCloseRef.current() : closeModal}
      onDismiss={handleDismiss}
    >
      <SafeAreaProvider>
        <SwipeBack enabled={visible && !viewerOpen && !childOverlayOpen} onBack={closeModal}>
          <SafeAreaView style={styles.container} edges={['top']}>
            <SwipeDownHeader onClose={closeModal} enabled={!viewerOpen && !childOverlayOpen && !busy}>
              <View style={styles.header}>
                {editMode ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={t('editKitWishlistTitle')}
                    accessibilityState={{ disabled: busy, busy }}
                    disabled={busy}
                    onPress={() => { void saveChanges(); }}
                    style={styles.backBtn}
                  >
                    <IconChevronLeft color={colors.primary} size={22} />
                    <Text style={styles.title}>{t('editKitWishlistTitle')}</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.title}>{t('kitWishlistDetailTitle')}</Text>
                )}
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t('close')}
                  accessibilityState={{ disabled: busy, busy }}
                  disabled={busy}
                  onPress={closeModal}
                  style={styles.headerButton}
                >
                  <IconX color={colors.text} size={24} />
                </TouchableOpacity>
              </View>
            </SwipeDownHeader>

            {loadState === 'loading' ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : loadState === 'error' ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <Text accessibilityRole="alert" style={styles.empty}>{t('loadFailed')}</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t('retry')}
                  onPress={() => { void load(true); }}
                  style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 24 }}
                >
                  <Text style={{ color: colors.primaryText, fontWeight: '700' }}>{t('retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : !item ? (
              <Text style={styles.empty}>{t('noResults')}</Text>
            ) : (
              <SwipeDownScrollView
                ref={scrollRef}
                style={styles.scroll}
                onClose={closeModal}
                closeEnabled={!viewerOpen && !childOverlayOpen && !busy}
                contentContainerStyle={styles.content}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.titleBlock}>
                  {editMode ? (
                    <>
                      <ClearableInput style={styles.nameEditInput} value={name} onChangeText={setName} placeholder={t('name')} />
                      <View style={styles.field}>
                        <Text style={styles.sectionTitle}>{t('maker')}</Text>
                        <ClearableInput style={styles.input} value={maker} onChangeText={setMaker} placeholder={t('maker')} />
                      </View>
                      <View style={styles.field}>
                        <Text style={styles.sectionTitle}>{t('scale')}</Text>
                        <ClearableInput style={styles.input} value={scale} onChangeText={setScale} placeholder="1/144" />
                      </View>
                    </>
                  ) : (
                    <View style={styles.nameRow}>
                      <View style={styles.nameActions}>
                        <Text style={styles.name}>{item.name}</Text>
                        <TouchableOpacity
                          onPress={() => { setDetailTab('details'); initialPhotoUrisRef.current = new Set(photos.map((photo) => photo.uri)); draftPhotoUrisRef.current = new Set(); setEditMode(true); }}
                          accessibilityRole="button"
                          accessibilityLabel={t('enterEditMode')}
                          hitSlop={8}
                        >
                          <IconEdit color={colors.textMuted} size={20} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                  {!editMode ? <Text style={styles.maker}>{item.maker}{item.scale ? ` · ${item.scale}` : ''}</Text> : null}
                </View>

                <KitPhotoGrid
                  photos={photos.map((photo) => ({ key: photo.id, uri: photo.uri }))}
                  editable={editMode}
                  disableTapPreview={editMode}
                  disabled={busy}
                  onViewerChange={setViewerOpen}
                  onAdd={(uri) => {
                    draftPhotoUrisRef.current.add(uri);
                    setPhotos((current) => [...current, { id: draftPhotoIdRef.current--, uri, sort_order: current.length, synced_at: null, storage_path: null }]);
                  }}
                  onRemove={(key) => {
                    const photo = photos.find((candidate) => candidate.id === key);
                    if (!photo) return;
                    if (draftPhotoUrisRef.current.delete(photo.uri)) {
                      void deleteKitPhoto(photo.uri).catch((error) => console.error('KitWishlistDetailModal: failed to remove unsaved photo', photo.uri, error));
                    }
                    setPhotos((current) => current.filter((candidate) => candidate.id !== key));
                  }}
                  onMove={(key, direction) => {
                    setPhotos((current) => {
                      const index = current.findIndex((photo) => photo.id === key);
                      const targetIndex = index + direction;
                      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
                      const next = [...current];
                      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
                      return next;
                    });
                  }}
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
                          {editMode ? <ClearableInput style={styles.input} value={series} onChangeText={setSeries} /> : <Text style={styles.pickerText}>{item.series || t('unknown')}</Text>}
                        </View>
                        <View style={[styles.field, styles.fieldHalf]}>
                          <Text style={styles.sectionTitle}>{t('category')}</Text>
                          {editMode ? <ClearableInput style={styles.input} value={category} onChangeText={setCategory} /> : <Text style={styles.pickerText}>{item.category || t('unknown')}</Text>}
                        </View>
                      </View>
                      <View style={styles.field}>
                        <Text style={styles.sectionTitle}>{t('price')}</Text>
                        {editMode ? <ClearableInput style={styles.input} value={price} onChangeText={setPrice} keyboardType="numeric" placeholder="0" /> : <Text style={styles.pickerText}>{item.price != null ? item.price.toLocaleString() : t('unknown')}</Text>}
                      </View>
                    </View>
                    <View style={styles.card}>
                      <Text style={styles.sectionTitle}>{t('note')}</Text>
                      {editMode ? <ClearableInput style={[styles.input, styles.noteInput]} value={note} onChangeText={setNote} multiline textAlignVertical="top" /> : <Text style={styles.pickerText}>{item.note?.trim() || '—'}</Text>}
                    </View>
                  </>
                ) : null}
                <KitUsedColorsPanel
                  active={usedColorsActive}
                  controller={usedColorController}
                  ownedMap={ownedMap}
                  scrollableRef={scrollRef}
                />
              </SwipeDownScrollView>
            )}

            {usedColorsActive ? (
              <KitUsedColorsOverlays
                controller={usedColorController}
                ownedMap={ownedMap}
                requestCloseRef={childRequestCloseRef}
              />
            ) : null}

            {item && editMode ? (
              <SafeAreaView edges={['bottom']} style={styles.editBar}>
                <TouchableOpacity
                  style={[styles.saveEditBtn, busy && styles.saveEditBtnDisabled]}
                  disabled={busy}
                  onPress={() => { void saveChanges(); }}
                  accessibilityRole="button"
                  accessibilityLabel={t('save')}
                  accessibilityState={{ disabled: busy, busy }}
                >
                  <Text style={styles.saveEditBtnText}>{t('save')}</Text>
                </TouchableOpacity>
              </SafeAreaView>
            ) : item ? (
              <SafeAreaView edges={['bottom']} style={styles.actionBar}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.moveButton]}
                  onPress={() => requestParentAction('move')}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={t('moveToBox')}
                  accessibilityState={{ disabled: busy, busy }}
                >
                  <IconBox color={colors.primaryText} size={20} />
                  <Text style={styles.actionText}>{t('moveToBox')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.deleteButton]}
                  onPress={() => requestParentAction('delete')}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={t('delete')}
                  accessibilityState={{ disabled: busy, busy }}
                >
                  <IconTrash color={colors.dangerText} size={20} />
                  <Text style={[styles.actionText, styles.deleteText]}>{t('delete')}</Text>
                </TouchableOpacity>
              </SafeAreaView>
            ) : null}
          </SafeAreaView>
        </SwipeBack>
      </SafeAreaProvider>
    </Modal>
  );
}
