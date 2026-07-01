// lib/brands.ts
// カタログの brand slug を表示名へ。未知は slug を整形してフォールバック。
import { getLocale } from './i18n';

const BRAND_NAMES: Record<string, { ja: string; en: string }> = {
  gsi_creos: { ja: 'GSIクレオス', en: 'GSI Creos' },
  tamiya: { ja: 'タミヤ', en: 'Tamiya' },
  gaianotes: { ja: 'ガイアノーツ', en: 'Gaianotes' },
  games_workshop: { ja: 'ゲームズワークショップ', en: 'Games Workshop' },
  finishers: { ja: 'フィニッシャーズ', en: 'Finishers' },
  vallejo: { ja: 'ファレホ', en: 'Vallejo' },
  bornpaint: { ja: 'ボーンペイント', en: 'Bornpaint' },
};

function prettify(slug: string): string {
  return slug.split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

export function brandLabel(brand: string): string {
  const entry = BRAND_NAMES[brand];
  if (!entry) return prettify(brand || '');
  return getLocale() === 'ja' ? entry.ja : entry.en;
}
