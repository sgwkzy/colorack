// components/AddKitModal.tsx
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { addKitPhoto, getKitWishlistPhotos, getDB, saveKitWishlistItem, type KitWishlistItem } from '../lib/db';
import { t } from '../lib/i18n';
import { deleteKitPhoto } from '../lib/kitPhoto';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';
import KitPhotoGrid from './KitPhotoGrid';
import SwipeDownHeader from './SwipeDownHeader';
import SwipeDownScrollView from './SwipeDownScrollView';

interface Props {
  visible: boolean;
  defaultBoxId: number | null;
  saveTarget?: 'owned' | 'wishlist';
  editWishlistItem?: KitWishlistItem | null;
  onClose: () => void;
}

export interface KitFormValues {
  name: string;
  maker: string;
  series: string;
  category: string;
  scale: string;
  price: string;
  note: string;
  photos: readonly string[];
}

export function isKitFormDirty(form: KitFormValues): boolean {
  return form.name !== '' || form.maker !== '' || form.series !== '' || form.category !== ''
    || form.scale !== '' || form.price !== '' || form.note !== '' || form.photos.length > 0;
}

export default function AddKitModal({ visible, defaultBoxId, saveTarget = 'owned', editWishlistItem, onClose }: Props) {
  useModalLock(visible);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [name, setName] = useState('');
  const [maker, setMaker] = useState('');
  const [series, setSeries] = useState('');
  const [category, setCategory] = useState('');
  const [scale, setScale] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const canSave = name.trim() !== '' && maker.trim() !== '' && !photoLoadFailed;
  const dirty = isKitFormDirty({ name, maker, series, category, scale, price, note, photos });
  const savingRef = useRef(false);
  const photoLoadVersionRef = useRef(0);
  const initialPhotoUrisRef = useRef(new Set<string>());
  const draftPhotoUrisRef = useRef(new Set<string>());
  const editingWishlist = saveTarget === 'wishlist' && editWishlistItem != null;

  useLayoutEffect(() => {
    const loadVersion = ++photoLoadVersionRef.current;
    initialPhotoUrisRef.current = new Set();
    draftPhotoUrisRef.current = new Set();
    setViewerOpen(false);
    setPhotoLoadFailed(false);
    if (!visible) { setBusy(false); return; }
    if (saveTarget === 'wishlist' && editWishlistItem) {
      setName(editWishlistItem.name); setMaker(editWishlistItem.maker); setSeries(editWishlistItem.series ?? ''); setCategory(editWishlistItem.category ?? '');
      setScale(editWishlistItem.scale ?? ''); setPrice(editWishlistItem.price?.toString() ?? ''); setNote(editWishlistItem.note ?? ''); setPhotos([]);
      setBusy(true);
      void (async () => {
        try {
          const nextPhotos = await getKitWishlistPhotos(editWishlistItem.id);
          if (loadVersion !== photoLoadVersionRef.current) return;
          const uris = nextPhotos.map((photo) => photo.uri);
          initialPhotoUrisRef.current = new Set(uris);
          setPhotos(uris);
        } catch (error) {
          if (loadVersion !== photoLoadVersionRef.current) return;
          console.error('AddKitModal: failed to load candidate photos', error);
          setPhotoLoadFailed(true);
          Alert.alert(t('error'), t('loadFailed'));
        } finally {
          if (loadVersion === photoLoadVersionRef.current) setBusy(false);
        }
      })();
      return;
    }
    setName(''); setMaker(''); setSeries(''); setCategory(''); setScale(''); setPrice(''); setNote(''); setPhotos([]); setViewerOpen(false);
    setBusy(false);
  }, [editWishlistItem, saveTarget, visible]);

  const removeDetachedCandidatePhotos = async (uris: readonly string[]) => {
    for (const uri of uris) {
      await deleteKitPhoto(uri).catch((error) =>
        console.error('AddKitModal: failed to remove detached candidate photo', uri, error)
      );
    }
  };

  const save = async () => {
    if (!canSave || savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    try {
      const trimmedPrice = price.trim();
      const parsedPrice = trimmedPrice === '' ? null : Number(trimmedPrice);
      if (parsedPrice !== null && (!Number.isInteger(parsedPrice) || parsedPrice < 0)) {
        Alert.alert(t('price'), t('invalidPrice'));
        return;
      }
      const normalizedPrice = parsedPrice !== null && Number.isInteger(parsedPrice) && parsedPrice >= 0 ? parsedPrice : null;
      if (saveTarget === 'wishlist') {
        const draft = {
          name: name.trim(), maker: maker.trim(), series: series.trim() || null,
          category: category.trim() || null, scale: scale.trim() || null,
          price: normalizedPrice, note: note.trim() || null,
        };
        const result = await saveKitWishlistItem(editWishlistItem?.id ?? null, draft, photos);
        draftPhotoUrisRef.current.clear();
        await removeDetachedCandidatePhotos(result.removedPhotoUris);
      } else {
        const result = await getDB().runAsync(
          'INSERT INTO kits (box_id, name, maker, series, category, scale, price, note, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [defaultBoxId, name.trim(), maker.trim(), series.trim() || null, category.trim() || null, scale.trim() || null, normalizedPrice, note.trim() || null, 'not_started']
        );
        for (const uri of photos) await addKitPhoto(result.lastInsertRowId, uri);
      }
      onClose();
    } catch (error) {
      console.error('AddKitModal: failed to save kit', error);
      Alert.alert(t('error'), t('saveFailed'));
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  const discard = useCallback(async () => {
    if (savingRef.current) return;
    const urisToDelete = saveTarget === 'wishlist'
      ? [...draftPhotoUrisRef.current].filter((uri) => !initialPhotoUrisRef.current.has(uri))
      : photos;
    try {
      for (const uri of urisToDelete) await deleteKitPhoto(uri);
    } catch (error) {
      console.error('AddKitModal: failed to discard kit photos', error);
      Alert.alert(t('error'), t('saveFailed'));
      return;
    }
    onClose();
  }, [onClose, photos, saveTarget]);

  const requestClose = useCallback(() => {
    if (!visible || savingRef.current) return;
    if (!dirty) { void discard(); return; }
    Alert.alert(t('discardChangesConfirm'), '', [
      { text: t('cancel'), style: 'cancel' },
      { text: t('discard'), style: 'destructive', onPress: () => { void discard(); } },
    ]);
  }, [discard, dirty, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={requestClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <SwipeDownHeader onClose={requestClose} enabled={!viewerOpen && !busy}>
            <View style={styles.header}>
              <Text style={styles.title}>{editingWishlist ? t('editKitWishlistItem') : t('addKit')}</Text>
              <TouchableOpacity
                onPress={requestClose}
                disabled={busy}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('close')}
                accessibilityState={{ disabled: busy, busy }}
              >
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <SwipeDownScrollView onClose={requestClose} closeEnabled={!viewerOpen && !busy} style={{ flex: 1 }} contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
            <KitPhotoGrid
              photos={photos.map((uri) => ({ key: uri, uri }))}
              editable
              disabled={busy}
              onViewerChange={setViewerOpen}
              onAdd={(uri) => {
                draftPhotoUrisRef.current.add(uri);
                setPhotos((current) => [...current, uri]);
              }}
              onRemove={(key) => {
                const uri = key as string;
                if (saveTarget === 'owned') {
                  deleteKitPhoto(uri);
                } else if (!initialPhotoUrisRef.current.has(uri)) {
                  draftPhotoUrisRef.current.delete(uri);
                  void deleteKitPhoto(uri).catch((error) => console.error('AddKitModal: failed to remove unsaved candidate photo', uri, error));
                }
                setPhotos((current) => current.filter((currentUri) => currentUri !== uri));
              }}
              onMove={(key, direction) => {
                setPhotos((current) => {
                  const index = current.indexOf(key as string);
                  const targetIndex = index + direction;
                  if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
                  const next = [...current];
                  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
                  return next;
                });
              }}
            />
            <View style={styles.field}>
              <Text style={styles.label}>{t('name')}*</Text>
              <ClearableInput style={styles.input} value={name} onChangeText={setName} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('maker')}*</Text>
              <ClearableInput style={styles.input} value={maker} onChangeText={setMaker} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('series')}</Text>
              <ClearableInput style={styles.input} value={series} onChangeText={setSeries} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('category')}</Text>
              <ClearableInput style={styles.input} value={category} onChangeText={setCategory} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('scale')}</Text>
              <ClearableInput style={styles.input} value={scale} onChangeText={setScale} placeholder="1/144" />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('price')}</Text>
              <ClearableInput style={styles.input} value={price} onChangeText={setPrice} keyboardType="numeric" placeholder="0" />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('note')}</Text>
              <ClearableInput style={[styles.input, styles.noteInput]} value={note} onChangeText={setNote} multiline textAlignVertical="top" />
            </View>
          </SwipeDownScrollView>
          {/* busy も無効表示に含める。保存中は閉じる操作も無視する(写真のコピー中に
              削除すると壊れたレコードが残るため)ので、見た目でも処理中だと分かるようにする。 */}
          <TouchableOpacity
            style={[styles.saveBtn, (!canSave || busy) && styles.saveBtnDisabled]}
            onPress={save}
            disabled={!canSave || busy}
            accessibilityRole="button"
            accessibilityLabel={t('save')}
            accessibilityState={{ disabled: !canSave || busy, busy }}
          >
            <Text style={styles.saveBtnText}>{t('save')}</Text>
          </TouchableOpacity>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  content: { padding: spacing.xl, gap: spacing.lg },
  field: { gap: spacing.xs },
  label: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.lg, color: colors.text },
  noteInput: { minHeight: 72, alignItems: 'flex-start' },
  saveBtn: { minHeight: touch.min, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, margin: spacing.xl, borderRadius: radius.md },
  saveBtnDisabled: { backgroundColor: colors.primaryDisabled },
  saveBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
});
