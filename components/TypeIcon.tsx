import { useMemo } from 'react';
// components/TypeIcon.tsx
import { Text, StyleSheet } from 'react-native';
import { paintTypeIcon } from '../lib/paintType';
import { useTheme, lightColors } from '../lib/theme';

// ラッカー=◯L / 水性アクリル=◯W のバッジ。該当なしは何も描画しない。
const colorForCode = (colors: typeof lightColors, code: string): string => ({
  La: colors.typeLacquer, // ラッカー(赤)
  Ac: colors.typeAcrylic, // 水性アクリル(青)
  En: colors.typeEnamel, // エナメル(緑)
  Em: colors.typeEmulsion, // エマルジョン(紫)
}[code] ?? colors.textFaint);

export default function TypeIcon({ paintType }: { paintType: string | null | undefined }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const code = paintTypeIcon(paintType);
  if (!code) return null;
  const color = colorForCode(colors, code);
  return (
    <Text style={[styles.badge, { borderColor: color, color }]}>{code}</Text>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  // 2文字のピル型バッジ
  badge: {
    minWidth: 24, height: 18, borderRadius: 9, borderWidth: 1,
    paddingHorizontal: 5, textAlign: 'center', lineHeight: 16,
    fontSize: 11, fontWeight: 'bold', marginRight: 4, overflow: 'hidden',
  },
});
