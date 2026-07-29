// lib/paintType.ts
// 塗料種別(paint_type)の表示ラベルとアイコン文字。
import { getLocale } from './i18n';

const TYPE_EN: Record<string, string> = {
  'ラッカー塗料': 'Lacquer',
  '水性アクリル塗料': 'Water-based Acrylic',
  'エナメル塗料': 'Enamel',
  'エマルジョン塗料': 'Emulsion',
  'エマルジョン系水性塗料': 'Water-based Emulsion',
};

// 種別バッジの2文字略号。La=ラッカー / Ac=水性アクリル / En=エナメル / Em=エマルジョン。
// (頭1文字だとエナメル/エマルジョンが衝突するため2文字)。該当なしは null。
// エマルジョンは水性より先に判定する。'エマルジョン系水性塗料'(GSIアクリジョン/
// シタデル)は '水性' を含むため、順序を逆にすると水性アクリルと同じ Ac になり、
// GSIの水性ホビーカラーとアクリジョンが見分けられなくなる。
export function paintTypeIcon(pt: string | null | undefined): string | null {
  if (!pt) return null;
  if (pt.includes('ラッカー')) return 'La';
  if (pt.includes('エマルジョン')) return 'Em';
  if (pt.includes('水性') || pt.includes('アクリル')) return 'Ac';
  if (pt.includes('エナメル')) return 'En';
  return null;
}

export function paintTypeLabel(pt: string | null | undefined): string {
  if (!pt) return '';
  if (getLocale() === 'ja') return pt;
  return TYPE_EN[pt] ?? pt;
}
