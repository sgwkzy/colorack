// components/AddKitModal.tsx
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { getDB } from '../lib/db';
import { t } from '../lib/i18n';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';
import KitPhotoPicker from './KitPhotoPicker';
import SwipeDownHeader from './SwipeDownHeader';
import SwipeDownScrollView from './SwipeDownScrollView';

interface Props {
  visible: boolean;
  defaultBoxId: number | null;
  onClose: () => void;
}

export default function AddKitModal({ visible, defaultBoxId, onClose }: Props) {
  useModalLock(visible);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [name, setName] = useState('');
  const [maker, setMaker] = useState('');
  const [scale, setScale] = useState('');
  const [note, setNote] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const canSave = name.trim() !== '' && maker.trim() !== '';

  useEffect(() => {
    if (visible) { setName(''); setMaker(''); setScale(''); setNote(''); setPhotoUri(null); }
  }, [visible]);

  const save = async () => {
    if (!canSave) return;
    await getDB().runAsync(
      'INSERT INTO kits (box_id, name, maker, scale, note, photo_uri, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [defaultBoxId, name.trim(), maker.trim(), scale.trim() || null, note.trim() || null, photoUri, 'not_started']
    );
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <SwipeDownHeader onClose={onClose}>
            <View style={styles.header}>
              <Text style={styles.title}>{t('addKit')}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>
          <SwipeDownScrollView onClose={onClose} style={{ flex: 1 }} contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
            <KitPhotoPicker photoUri={photoUri} onChange={setPhotoUri} />
            <View style={styles.field}>
              <Text style={styles.label}>{t('name')}*</Text>
              <ClearableInput style={styles.input} value={name} onChangeText={setName} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('maker')}*</Text>
              <ClearableInput style={styles.input} value={maker} onChangeText={setMaker} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('scale')}</Text>
              <ClearableInput style={styles.input} value={scale} onChangeText={setScale} placeholder="1/144" />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('note')}</Text>
              <ClearableInput style={[styles.input, styles.noteInput]} value={note} onChangeText={setNote} multiline textAlignVertical="top" />
            </View>
          </SwipeDownScrollView>
          <TouchableOpacity style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]} onPress={save} disabled={!canSave}>
            <Text style={styles.saveBtnText}>{t('save')}</Text>
          </TouchableOpacity>
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
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text },
  noteInput: { minHeight: 72, alignItems: 'flex-start' },
  saveBtn: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, margin: spacing.xl, borderRadius: radius.md },
  saveBtnDisabled: { backgroundColor: colors.primaryDisabled },
  saveBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
});
