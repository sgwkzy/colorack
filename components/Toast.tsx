import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';

interface Props {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function Toast({ message, actionLabel, onAction }: Props) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  if (!message) return null;

  return (
    <View style={styles.toast} pointerEvents={onAction ? 'box-none' : 'none'}>
      <Text style={styles.toastText}>{message}</Text>
      {onAction && actionLabel ? (
        <TouchableOpacity onPress={onAction} hitSlop={8} style={styles.actionBtn}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: typeof lightColors, isDark: boolean) => StyleSheet.create({
  toast: {
    position: 'absolute',
    left: spacing.xxl,
    right: spacing.xxl,
    bottom: 32,
    backgroundColor: isDark ? colors.surfaceAlt : 'rgba(0,0,0,0.82)',
    borderWidth: isDark ? 1 : 0,
    borderColor: isDark ? colors.border : colors.transparent,
    borderRadius: radius.pill + 4,
    paddingVertical: 10,
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastText: { color: isDark ? colors.text : colors.onPrimary, fontSize: 14 },
  actionBtn: { marginLeft: spacing.md },
  actionText: { color: isDark ? colors.primary : '#8ecbff', fontSize: 14, fontWeight: 'bold' },
});
