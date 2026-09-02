import { useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconChevronLeft, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../lib/i18n';
import { useModalLock } from '../lib/modalLock';
import { lightColors, spacing, touch, useTheme } from '../lib/theme';
import ColorMatcher from './AddPaint/ColorMatcher';
import HierarchyBrowser from './AddPaint/HierarchyBrowser';
import SwipeDownHeader from './SwipeDownHeader';

type PickerPaint = { id: number };

interface Props {
  visible: boolean;
  paintType?: string;
  title?: string;
  embedded?: boolean;
  onBack?: () => void;
  onSelect: (paint: PickerPaint) => Promise<boolean>;
  onClose: () => void;
}

export default function ColorMixPaintPickerModal({ visible, paintType, title, embedded = false, onBack, onSelect, onClose }: Props) {
  useModalLock(visible && !embedded);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<'hierarchy' | 'colorMatch'>('hierarchy');
  const selectingRef = useRef(false);

  const select = async (paint: PickerPaint) => {
    if (selectingRef.current) return;
    selectingRef.current = true;
    try {
      if (await onSelect(paint)) onClose();
    } finally {
      selectingRef.current = false;
    }
  };

  const screen = (
    <SafeAreaView
      accessibilityViewIsModal={embedded}
      style={[styles.container, embedded && styles.embedded, embedded && { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      edges={embedded ? [] : ['top', 'bottom']}
    >
      <SwipeDownHeader onClose={onClose}>
        <View style={styles.header}>
          {onBack ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('back')} onPress={onBack} style={styles.headerButton}>
              <IconChevronLeft color={colors.primary} size={24} />
            </TouchableOpacity>
          ) : <View style={styles.headerButton} />}
          <Text numberOfLines={1} style={styles.title}>{title ?? t('addPaint')}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('close')} onPress={onClose} style={styles.headerButton}>
            <IconX color={colors.text} size={24} />
          </TouchableOpacity>
        </View>
      </SwipeDownHeader>
      <View accessibilityRole="tablist" style={styles.tabs}>
        {(['hierarchy', 'colorMatch'] as const).map((key) => (
          <TouchableOpacity key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.tabActive]}>
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{t(key)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.content}>
        {tab === 'hierarchy'
          ? <HierarchyBrowser key={paintType ?? 'all'} paintType={paintType} selectionOnly onSelect={select} onSelectView={select} onRequestClose={onClose} />
          : <ColorMatcher key={paintType ?? 'all'} lockedPaintType={paintType} selectionOnly onSelect={select} onSelectView={select} onRequestClose={onClose} />}
      </View>
    </SafeAreaView>
  );

  if (embedded) return visible ? screen : null;
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}><SafeAreaProvider>{screen}</SafeAreaProvider></Modal>;
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  embedded: { ...StyleSheet.absoluteFillObject, zIndex: 100, elevation: 100 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  headerButton: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  tab: { flex: 1, minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: colors.transparent },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { color: colors.textMuted },
  tabTextActive: { color: colors.primaryText, fontWeight: '700' },
  content: { flex: 1 },
});
