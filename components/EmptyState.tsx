import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Icon } from '@tabler/icons-react-native';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';

interface Props {
  icon: Icon;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({ icon: Icon, title, actionLabel, onAction }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <Icon color={colors.textFaint} size={48} />
      <Text style={styles.title}>{title}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity style={styles.actionBtn} onPress={onAction} accessibilityRole="button">
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', paddingTop: 64, paddingHorizontal: spacing.xxl },
  title: { fontSize: 15, color: colors.textFaint, marginTop: spacing.lg, textAlign: 'center' },
  actionBtn: { marginTop: spacing.xl, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  actionText: { color: colors.onPrimary, fontWeight: 'bold' },
});
