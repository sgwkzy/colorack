// カタログ塗料名/シリーズ名の表示ロケール切り替え。
import { getLocale } from './i18n';

function enOrJa(ja: string, en: string | null | undefined): string {
  return getLocale() === 'en' && en?.trim() ? en : ja;
}

export function paintName(nameJa: string, nameEn: string | null): string {
  return enOrJa(nameJa, nameEn);
}

export function seriesLabel(seriesJa: string, seriesEn: string | null | undefined): string {
  return enOrJa(seriesJa, seriesEn);
}
