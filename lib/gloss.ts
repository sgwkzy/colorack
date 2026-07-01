// lib/gloss.ts
// つや(gloss) の日本語値を表示用ラベルへ。en ロケールは英訳、未知はそのまま。
import { getLocale } from './i18n';

const GLOSS_EN: Record<string, string> = {
  '光沢': 'Gloss',
  '半光沢': 'Semi-gloss',
  'メタリック': 'Metallic',
  'つや消し': 'Matte',
  'パール': 'Pearl',
};

export function glossLabel(gloss: string | null | undefined): string {
  if (!gloss) return '';
  if (getLocale() === 'ja') return gloss;
  return GLOSS_EN[gloss] ?? gloss;
}
