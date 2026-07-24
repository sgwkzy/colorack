import { useEffect, useMemo, useState } from 'react';
import {
  Modal, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { t } from '../lib/i18n';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';

interface Props {
  visible: boolean;
  title: string;
  initialValue?: string;
  onSubmit: (text: string) => void;
  onClose: () => void;
}

export default function TextPromptModal({ visible, title, initialValue = '', onSubmit, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [text, setText] = useState(initialValue);
  const trimmed = text.trim();

  useEffect(() => {
    if (visible) setText(initialValue);
  }, [visible, initialValue]);

  const submit = () => {
    if (!trimmed) return;
    onSubmit(trimmed);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <ClearableInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          <View style={styles.actions}>
            <TouchableOpacity style={styles.button} onPress={onClose}>
              <Text style={styles.cancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.okButton, !trimmed && styles.okButtonDisabled]}
              onPress={submit}
              disabled={!trimmed}
            >
              <Text style={styles.okText}>{t('ok')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  card: { alignSelf: 'stretch', maxWidth: 360, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.xl },
  title: { fontSize: 17, fontWeight: 'bold', color: colors.text, marginBottom: spacing.lg },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text, minHeight: touch.min },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.xl },
  button: { minHeight: touch.min, minWidth: 72, paddingHorizontal: spacing.xl, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md },
  okButton: { backgroundColor: colors.primary },
  okButtonDisabled: { backgroundColor: colors.primaryDisabled },
  cancelText: { color: colors.primaryText, fontWeight: 'bold' },
  okText: { color: colors.onPrimary, fontWeight: 'bold' },
});
