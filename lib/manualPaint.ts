import { Alert } from 'react-native';
import { hex_to_rgb, rgb_to_lab } from './color';

export interface ManualPaintInput {
  nameJa: string;
  brand: string;
  series: string;
  code: string;
  hex: string;
  gloss: string | null;
  paintType: string | null;
}

export function validateManualPaint(input: ManualPaintInput) {
  if (!input.nameJa.trim() || !input.brand.trim() || !input.series.trim()) {
    Alert.alert('入力エラー', '名前・ブランド・シリーズは必須です');
    return null;
  }

  let normalizedHex: string | null = null;
  let rgb: { r: number; g: number; b: number } | null = null;
  let lab: { L: number; a: number; b: number } | null = null;
  if (input.hex.trim()) {
    rgb = hex_to_rgb(input.hex);
    if (!rgb) {
      Alert.alert('入力エラー', 'カラーコードの形式が不正です (#RRGGBB)');
      return null;
    }
    lab = rgb_to_lab(rgb.r, rgb.g, rgb.b);
    normalizedHex = `#${input.hex.replace('#', '')}`;
  }

  return {
    brand: input.brand.trim(),
    series: input.series.trim(),
    code: input.code.trim() || `MANUAL_${Date.now()}`,
    nameJa: input.nameJa.trim(),
    normalizedHex,
    rgb,
    lab,
    gloss: input.gloss,
    paintType: input.paintType,
  };
}

