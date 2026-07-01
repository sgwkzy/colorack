// components/TypeIcon.tsx
import { Text, StyleSheet } from 'react-native';
import { paintTypeIcon } from '../lib/paintType';

// ラッカー=◯L / 水性アクリル=◯W のバッジ。該当なしは何も描画しない。
const COLOR: Record<string, string> = {
  La: '#c0392b', // ラッカー(赤)
  Ac: '#2980b9', // 水性アクリル(青)
  En: '#27ae60', // エナメル(緑)
  Em: '#8e44ad', // エマルジョン(紫)
};

export default function TypeIcon({ paintType }: { paintType: string | null | undefined }) {
  const code = paintTypeIcon(paintType);
  if (!code) return null;
  const color = COLOR[code] ?? '#888';
  return (
    <Text style={[styles.badge, { borderColor: color, color }]}>{code}</Text>
  );
}

const styles = StyleSheet.create({
  // 2文字のピル型バッジ
  badge: {
    minWidth: 24, height: 18, borderRadius: 9, borderWidth: 1,
    paddingHorizontal: 5, textAlign: 'center', lineHeight: 16,
    fontSize: 11, fontWeight: 'bold', marginRight: 4, overflow: 'hidden',
  },
});
