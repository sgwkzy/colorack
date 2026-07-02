// components/AddPaint/index.tsx
import { useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { getDB, PaintStatus } from '../../lib/db';
import { t } from '../../lib/i18n';
import { paintName } from '../../lib/paintLabel';
import { colors, spacing } from '../../lib/theme';
import TextSearch from './TextSearch';
import HierarchyBrowser from './HierarchyBrowser';
import ColorMatcher from './ColorMatcher';
import ManualEntry from './ManualEntry';

interface Paint {
  id: number;
  name_ja: string;
  name_en: string | null;
  brand: string;
  hex: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  defaultStatus: string;
  boxId?: number | null;
}

const TABS = ['hierarchy', 'textSearch', 'colorMatch', 'manual'] as const;

export default function AddPaintModal({ visible, onClose, defaultStatus, boxId = null }: Props) {
  const [tab, setTab] = useState<typeof TABS[number]>('hierarchy');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isInventory = defaultStatus !== 'favorites' && defaultStatus !== 'wishlist';

  // 追加後はモーダルを閉じず、追加した旨を一時表示(連続登録できるように)。
  // opts は手動登録で在庫ステータス/ボックスを個別指定するとき使う。
  const addToInventory = async (paint: Paint, opts?: { status?: PaintStatus; boxId?: number | null }) => {
    const db = getDB();
    if (!isInventory) {
      await db.runAsync(
        'INSERT INTO lists (type, paint_id) VALUES (?, ?)',
        [defaultStatus, paint.id]
      );
    } else {
      await db.runAsync(
        'INSERT INTO inventory (paint_id, status, box_id) VALUES (?, ?, ?)',
        [paint.id, opts?.status ?? defaultStatus, opts?.boxId !== undefined ? opts.boxId : boxId]
      );
    }
    setToast(paintName(paint.name_ja, paint.name_en) + t('addedToast'));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1800);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('addPaint')}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <IconX color={colors.text} size={24} />
            </TouchableOpacity>
          </View>
          <View style={styles.tabBar}>
            {TABS.map((tabKey) => (
              <TouchableOpacity
                key={tabKey}
                style={[styles.tabBtn, tab === tabKey && styles.tabBtnActive]}
                onPress={() => setTab(tabKey)}
              >
                <Text style={[styles.tabText, tab === tabKey && styles.tabTextActive]}>
                  {t(tabKey)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.content}>
            {tab === 'hierarchy' && <HierarchyBrowser onSelect={addToInventory} />}
            {tab === 'textSearch' && <TextSearch onSelect={addToInventory} />}
            {tab === 'colorMatch' && <ColorMatcher onSelect={addToInventory} />}
            {tab === 'manual' && (
              <ManualEntry
                onSelect={addToInventory}
                showInventory={isInventory}
                defaultBoxId={boxId}
              />
            )}
          </View>
          {toast ? (
            <View style={styles.toast} pointerEvents="none">
              <Text style={styles.toastText}>{toast}</Text>
            </View>
          ) : null}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 18, fontWeight: 'bold' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  tabBtn: { flex: 1, padding: spacing.lg, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabText: { fontSize: 13, color: colors.textPlaceholder },
  tabTextActive: { color: colors.primary, fontWeight: 'bold' },
  content: { flex: 1 },
  toast: { position: 'absolute', left: spacing.xxl, right: spacing.xxl, bottom: 32, backgroundColor: 'rgba(0,0,0,0.82)', borderRadius: 20, paddingVertical: 10, paddingHorizontal: spacing.xl, alignItems: 'center' },
  toastText: { color: colors.onPrimary, fontSize: 14 },
});
