import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';

interface Props {
  message: string;
}

export default function Toast({ message }: Props) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  if (!message) return null;

  return (
    <View style={styles.toast} pointerEvents="none">
      <Text style={styles.toastText}>{message}</Text>
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
    alignItems: 'center',
  },
  toastText: { color: isDark ? colors.text : colors.onPrimary, fontSize: 14 },
});
