import { useMemo } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';

export interface ActionSheetButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface Props {
  visible: boolean;
  title?: string;
  message?: string;
  buttons: ActionSheetButton[];
  onClose: () => void;
}

export default function ActionSheet({ visible, title, message, buttons, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const press = (btn: ActionSheetButton) => {
    onClose();
    btn.onPress?.();
  };
  const mainButtons = buttons.filter((b) => b.style !== 'cancel');
  const cancelButtons = buttons.filter((b) => b.style === 'cancel');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaProvider>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <SafeAreaView edges={['bottom']} style={styles.sheetWrap}>
            <Pressable>
              {(title || message) && (
                <View style={styles.header}>
                  {title ? <Text style={styles.title}>{title}</Text> : null}
                  {message ? <Text style={styles.message}>{message}</Text> : null}
                </View>
              )}
              <View style={styles.card}>
                {mainButtons.map((b, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.row, i > 0 && styles.rowBorder]}
                    onPress={() => press(b)}
                  >
                    <Text style={[styles.rowText, b.style === 'destructive' && styles.destructiveText]}>{b.text}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {cancelButtons.map((b, i) => (
                <TouchableOpacity key={i} style={[styles.card, styles.cancelCard]} onPress={() => press(b)}>
                  <Text style={styles.cancelText}>{b.text}</Text>
                </TouchableOpacity>
              ))}
            </Pressable>
          </SafeAreaView>
        </Pressable>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  // 半透明だと背後のスワイプ残像やトーストが透けて見えるため、十分に不透明にする
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'flex-end' },
  sheetWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  header: { alignItems: 'center', paddingVertical: spacing.lg, paddingHorizontal: spacing.xl, backgroundColor: colors.surfaceAlt, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
  title: { fontSize: 13, color: colors.textFaint, fontWeight: 'bold' },
  message: { fontSize: 13, color: colors.textFaint, marginTop: spacing.xs },
  card: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, overflow: 'hidden', marginTop: spacing.sm },
  cancelCard: { marginTop: spacing.sm },
  row: { minHeight: touch.min, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowText: { fontSize: 17, color: colors.primary },
  destructiveText: { color: colors.danger },
  cancelText: { fontSize: 17, fontWeight: 'bold', color: colors.primary, textAlign: 'center', minHeight: touch.min, textAlignVertical: 'center' },
});
