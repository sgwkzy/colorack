import { useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react-native';
import { t, useLocale } from '../lib/i18n';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';

interface Box { id: number; name: string; }
interface Props { visible: boolean; boxes: Box[]; onSave: (ids: number[]) => void; onClose: () => void; }

export default function BoxOrderModal({ visible, boxes, onSave, onClose }: Props) {
  useModalLock(visible);
  const locale = useLocale();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [ordered, setOrdered] = useState(boxes);
  const title = locale === 'ja' ? 'ボックスを並び替え' : 'Reorder Boxes';

  useEffect(() => { if (visible) setOrdered(boxes); }, [visible, boxes]);
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    setOrdered(next);
  };

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.backdrop}><View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {ordered.map((box, index) => <View key={box.id} style={styles.row}>
        <Text style={styles.name} numberOfLines={1}>{box.name}</Text>
        <TouchableOpacity disabled={index === 0} onPress={() => move(index, -1)} style={[styles.move, index === 0 && styles.disabled]} accessibilityLabel="Move up"><IconChevronUp size={22} color={colors.text} /></TouchableOpacity>
        <TouchableOpacity disabled={index === ordered.length - 1} onPress={() => move(index, 1)} style={[styles.move, index === ordered.length - 1 && styles.disabled]} accessibilityLabel="Move down"><IconChevronDown size={22} color={colors.text} /></TouchableOpacity>
      </View>)}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.button} onPress={onClose}><Text style={styles.cancel}>{t('cancel')}</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.save]} onPress={() => { onSave(ordered.map((box) => box.id)); onClose(); }}><Text style={styles.saveText}>{t('save')}</Text></TouchableOpacity>
      </View>
    </View></View>
  </Modal>;
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: 'rgba(0,0,0,0.35)' },
  card: { width: '100%', maxWidth: 360, padding: spacing.xl, borderRadius: radius.md, backgroundColor: colors.surface },
  title: { marginBottom: spacing.lg, color: colors.text, fontSize: 17, fontWeight: '700' },
  row: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  name: { flex: 1, color: colors.text, fontSize: 16 },
  move: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.xl },
  button: { minWidth: 72, minHeight: touch.min, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, marginLeft: spacing.md },
  save: { backgroundColor: colors.primary }, cancel: { color: colors.primaryText, fontWeight: '700' }, saveText: { color: colors.onPrimary, fontWeight: '700' },
});
