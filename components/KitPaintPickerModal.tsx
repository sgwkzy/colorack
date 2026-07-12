// components/KitPaintPickerModal.tsx
import { useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconPlus, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { addKitPaint, getDB } from '../lib/db';
import { t } from '../lib/i18n';
import { paintName } from '../lib/paintLabel';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';
import PaintRow from './PaintRow';
import SwipeDownHeader from './SwipeDownHeader';
import Toast from './Toast';

interface Paint {
  id: number;
  name_ja: string;
  name_en: string | null;
  code: string;
  brand: string;
  hex: string;
  gloss: string | null;
  paint_type: string | null;
}

interface Props {
  visible: boolean;
  kitId: number;
  onClose: () => void;
  onAdded: () => void;
}

export default function KitPaintPickerModal({ visible, kitId, onClose, onAdded }: Props) {
  useModalLock(visible);
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Paint[]>([]);
  const [toast, setToast] = useState('');

  const search = async (q: string) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); return; }
    const rows = await getDB().getAllAsync<Paint>(
      'SELECT id, name_ja, name_en, code, brand, hex, gloss, paint_type FROM catalog_paints'
      + ' WHERE name_ja LIKE ? OR name_en LIKE ? OR brand LIKE ? OR series LIKE ?'
      + ' LIMIT 50',
      [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`]
    );
    setResults(rows);
  };

  const add = async (paint: Paint) => {
    await addKitPaint(kitId, paint.id);
    onAdded();
    setToast(paintName(paint.name_ja, paint.name_en) + t('addedToast'));
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <SwipeDownHeader onClose={onClose}>
            <View style={styles.header}>
              <Text style={styles.title}>{t('addColor')}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>
          <ClearableInput style={styles.input} placeholder={t('searchPlaceholder')} value={query} onChangeText={search} />
          <FlatList
            data={results}
            keyExtractor={(item) => String(item.id)}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <PaintRow paint={item}>
                <TouchableOpacity style={styles.addBtn} onPress={() => add(item)}>
                  <IconPlus color={colors.onPrimary} size={22} />
                </TouchableOpacity>
              </PaintRow>
            )}
          />
          <Toast message={toast} />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10, margin: spacing.lg, color: colors.text },
  addBtn: { width: touch.min, height: touch.min, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md },
});
