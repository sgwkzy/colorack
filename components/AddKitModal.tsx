// components/AddKitModal.tsx
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { addKitPhoto, getDB } from '../lib/db';
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
  addToWishlist?: boolean;
  onClose: () => void;
}

export default function AddKitModal({ visible, defaultBoxId, addToWishlist = false, onClose }: Props) {
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
  const [viewerOpen, setViewerOpen] = useState(false);
  const canSave = name.trim() !== '' && maker.trim() !== '';

  useEffect(() => {
    if (visible) { setName(''); setMaker(''); setSeries(''); setCategory(''); setScale(''); setPrice(''); setNote(''); setPhotos([]); setViewerOpen(false); }
  }, [visible]);

  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    try {
    const trimmedPrice = price.trim();
    const parsedPrice = trimmedPrice === '' ? null : Number(trimmedPrice);
    if (parsedPrice !== null && (!Number.isInteger(parsedPrice) || parsedPrice < 0)) {
      Alert.alert(t('price'), t('invalidPrice'));
      return;
    }
    const normalizedPrice = parsedPrice !== null && Number.isInteger(parsedPrice) && parsedPrice >= 0 ? parsedPrice : null;
    const result = await getDB().runAsync(
      'INSERT INTO kits (box_id, name, maker, series, category, scale, price, note, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [defaultBoxId, name.trim(), maker.trim(), series.trim() || null, category.trim() || null, scale.trim() || null, normalizedPrice, note.trim() || null, 'not_started']
    );
    const kitId = result.lastInsertRowId;
    if (addToWishlist) await getDB().runAsync('INSERT INTO kit_lists (kit_id) VALUES (?)', [kitId]);
    for (const uri of photos) await addKitPhoto(kitId, uri);
    onClose();
    } finally { setBusy(false); }
  };

  const cancelAndClose = async () => {
    for (const uri of photos) await deleteKitPhoto(uri);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={cancelAndClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <SwipeDownHeader onClose={cancelAndClose} enabled={!viewerOpen}>
            <View style={styles.header}>
              <Text style={styles.title}>{t('addKit')}</Text>
              <TouchableOpacity onPress={cancelAndClose} hitSlop={8} accessibilityLabel={t('close')}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <SwipeDownScrollView onClose={cancelAndClose} closeEnabled={!viewerOpen} style={{ flex: 1 }} contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
            <KitPhotoGrid
              photos={photos.map((uri) => ({ key: uri, uri }))}
              editable
              onViewerChange={setViewerOpen}
              onAdd={(uri) => setPhotos((current) => [...current, uri])}
              onRemove={(key) => {
                deleteKitPhoto(key as string);
                setPhotos((current) => current.filter((uri) => uri !== key));
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
          <TouchableOpacity style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]} onPress={save} disabled={!canSave || busy}>
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
