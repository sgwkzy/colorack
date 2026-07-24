// components/AddPaint/index.tsx
import { useRef, useState, useMemo } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { logEvent } from '../../lib/analytics';
import { getDB, getListMembership, PaintStatus } from '../../lib/db';
import { t } from '../../lib/i18n';
import { paintName } from '../../lib/paintLabel';
import { useTheme, lightColors, spacing } from '../../lib/theme';
import AdBanner from '../AdBanner';
import PaintDetailModal from '../PaintDetailModal';
import SwipeDownHeader from '../SwipeDownHeader';
import TextSearch from './TextSearch';
import HierarchyBrowser from './HierarchyBrowser';
import ColorMatcher from './ColorMatcher';
import ManualEntry from './ManualEntry';
import Toast from '../Toast';
import { useModalLock } from '../../lib/modalLock';

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
  useModalLock(visible);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<typeof TABS[number]>('hierarchy');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [detailPaintId, setDetailPaintId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const isInventory = defaultStatus !== 'favorites' && defaultStatus !== 'wishlist';

  // 追加後はモーダルを閉じず、追加した旨を一時表示(連続登録できるように)。
  // opts は手動登録で在庫ステータス/ボックスを個別指定するとき使う。
  const addToInventory = async (paint: Paint, opts?: { status?: PaintStatus; boxId?: number | null }) => {
    if (busy) return;
    setBusy(true);
    try {
    const db = getDB();
    if (!isInventory) {
      const membership = await getListMembership(paint.id);
      if (membership[defaultStatus as 'favorites' | 'wishlist']) {
        setToast(paintName(paint.name_ja, paint.name_en) + t('alreadyInList'));
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(''), 1800);
        return;
      }
      await db.runAsync(
        'INSERT OR IGNORE INTO lists (type, paint_id) VALUES (?, ?)',
        [defaultStatus, paint.id]
      );
      logEvent('add_to_list', { list_type: defaultStatus, action: 'add' });
    } else {
      await db.runAsync(
        'INSERT INTO inventory (paint_id, status, box_id) VALUES (?, ?, ?)',
        [paint.id, opts?.status ?? defaultStatus, (opts?.status ?? defaultStatus) === 'used_up' ? null : (opts?.boxId !== undefined ? opts.boxId : boxId)]
      );
      logEvent('add_to_inventory', { source: tab, brand: paint.brand });
    }
    setToast(paintName(paint.name_ja, paint.name_en) + t('addedToast'));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1800);
    } finally { setBusy(false); }
  };

  // このモーダルは開いたまま、色詳細を別モーダルとして重ねて表示する。
  // 一覧に戻ってきて別の色をまた見る、を繰り返しやすくするため。
  const viewPaintDetail = (paint: Paint) => setDetailPaintId(paint.id);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <SwipeDownHeader onClose={onClose}>
            <View style={styles.header}>
              <Text style={styles.title}>{t('addPaint')}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityLabel={t('close')}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>
          <View style={styles.tabBar}>
            {TABS.map((tabKey) => (
              <TouchableOpacity
                key={tabKey}
                style={[styles.tabBtn, tab === tabKey && styles.tabBtnActive]}
                onPress={() => setTab(tabKey)}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === tabKey }}
              >
                <Text style={[styles.tabText, tab === tabKey && styles.tabTextActive]} numberOfLines={1}>
                  {t(tabKey)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.content}>
            {tab === 'hierarchy' && <HierarchyBrowser onSelect={addToInventory} onSelectView={viewPaintDetail} onRequestClose={onClose} />}
            {tab === 'textSearch' && <TextSearch onSelect={addToInventory} onSelectView={viewPaintDetail} onRequestClose={onClose} />}
            {tab === 'colorMatch' && <ColorMatcher onSelect={addToInventory} onSelectView={viewPaintDetail} onRequestClose={onClose} />}
            {tab === 'manual' && (
              <ManualEntry
                onSelect={addToInventory}
                showInventory={isInventory}
                defaultBoxId={boxId}
                onRequestClose={onClose}
              />
            )}
          </View>
          <View style={styles.adBar}><AdBanner /></View>
          <Toast message={toast} />
          <PaintDetailModal
            visible={detailPaintId != null}
            paintId={detailPaintId}
            onClose={() => setDetailPaintId(null)}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  tabBtn: { flex: 1, padding: spacing.lg, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabText: { fontSize: 13, color: colors.textPlaceholder },
  tabTextActive: { color: colors.primaryText, fontWeight: 'bold' },
  content: { flex: 1 },
  adBar: { borderTopWidth: 1, borderTopColor: colors.borderLight },
});
