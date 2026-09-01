import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconChevronDown } from '@tabler/icons-react-native';
import { t } from '../lib/i18n';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';

interface BoxChoice { id: number; name: string; }

interface Props {
  visible: boolean;
  boxes: BoxChoice[];
  selectedBoxId: number | null;
  busy?: boolean;
  title?: string;
  onSelect: (boxId: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function RestoreToBoxModal({ visible, boxes, selectedBoxId, busy = false, title, onSelect, onCancel, onConfirm }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => { if (!visible) setPickerOpen(false); }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? undefined : onCancel}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={busy ? undefined : onCancel} />
        <View style={styles.card}>
          <Text style={styles.title}>{title ?? t('restore')}</Text>
          <Text style={styles.message}>{t('restoreToBoxMessage')}</Text>
          <TouchableOpacity
            style={styles.select}
            onPress={() => setPickerOpen((open) => !open)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('box')}
            accessibilityState={{ disabled: busy }}
          >
            <Text style={styles.selectText} numberOfLines={1}>
              {boxes.find((box) => box.id === selectedBoxId)?.name ?? t('unassigned')}
            </Text>
            <IconChevronDown color={colors.textMuted} size={18} />
          </TouchableOpacity>
          {pickerOpen ? (
            <ScrollView style={styles.list}>
              {boxes.map((box) => (
                <TouchableOpacity
                  key={box.id}
                  style={styles.option}
                  onPress={() => { onSelect(box.id); setPickerOpen(false); }}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ selected: box.id === selectedBoxId, disabled: busy }}
                >
                  <Text style={styles.optionText} numberOfLines={1}>{box.name}</Text>
                  <Text style={styles.check}>{box.id === selectedBoxId ? '\u2713' : ''}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.button} onPress={onCancel} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy }}>
              <Text style={styles.buttonText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={onConfirm} disabled={busy || selectedBoxId == null} accessibilityRole="button" accessibilityState={{ disabled: busy || selectedBoxId == null }}>
              <Text style={[styles.buttonText, styles.primaryButtonText, (busy || selectedBoxId == null) && styles.disabledText]}>{t('restore')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: spacing.xxl },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.32)' },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.xl },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  message: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  select: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.lg, paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  selectText: { flex: 1, color: colors.text, fontSize: 16 },
  list: { maxHeight: 220, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.sm },
  option: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight },
  optionText: { flex: 1, color: colors.text, fontSize: 16 },
  check: { color: colors.primaryText, fontSize: 18, fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, marginTop: spacing.lg },
  button: { minHeight: touch.min, justifyContent: 'center', paddingHorizontal: spacing.lg },
  buttonText: { color: colors.textMuted, fontSize: 16, fontWeight: '600' },
  primaryButtonText: { color: colors.primaryText },
  disabledText: { color: colors.textFaint },
});
