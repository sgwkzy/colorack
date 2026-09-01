import { useMemo } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconChevronRight } from '@tabler/icons-react-native';
import { t } from '../lib/i18n';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';

interface BoxChoice { id: number; name: string; }

interface Props {
  visible: boolean;
  boxes: BoxChoice[];
  busy?: boolean;
  title?: string;
  onChoose: (boxId: number) => void;
  onCancel: () => void;
}

export default function RestoreToBoxModal({ visible, boxes, busy = false, title, onChoose, onCancel }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? undefined : onCancel}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={busy ? undefined : onCancel} />
        <View style={styles.card}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title ?? t('restoreToBoxTitle')}</Text>
            {busy ? <ActivityIndicator color={colors.primary} /> : null}
          </View>
          <Text style={styles.message}>{t('restoreToBoxMessage')}</Text>
          <ScrollView style={styles.list}>
            {boxes.map((box) => (
              <TouchableOpacity
                key={box.id}
                style={styles.option}
                onPress={() => onChoose(box.id)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
              >
                <Text style={styles.optionText} numberOfLines={1}>{box.name}</Text>
                <IconChevronRight color={colors.textMuted} size={18} />
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy }}>
            <Text style={styles.cancelText}>{t('cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: spacing.xxl },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.32)' },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.xl },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '700' },
  message: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  list: { maxHeight: 260, marginTop: spacing.lg, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.sm },
  option: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight },
  optionText: { flex: 1, color: colors.text, fontSize: 16 },
  cancelButton: { minHeight: touch.min, alignSelf: 'flex-end', justifyContent: 'center', marginTop: spacing.md, paddingHorizontal: spacing.lg },
  cancelText: { color: colors.textMuted, fontSize: 16, fontWeight: '600' },
});
