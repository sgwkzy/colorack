export type PaintStatus = 'owned' | 'in_use' | 'used_up';
export type KitStatus = 'not_started' | 'building' | 'completed';
export type ListType = 'favorites' | 'wishlist';

export type SeedRow = {
  brand: string; series: string; series_en: string | null; code: string;
  name_ja: string; name_en: string | null; hex: string | null;
  rgb_r: number | null; rgb_g: number | null; rgb_b: number | null;
  lab_l: number | null; lab_a: number | null; lab_b: number | null;
  barcode: string | null; gloss: string | null; paint_type: string | null;
};

// シード内容を更新したら上げる。catalog_paints を作り直して再シードする。
// (INSERT OR IGNORE のため既存行は更新されない。過去の壊れた名前を一掃する用途も兼ねる)
export const SEED_VERSION = 19;

// 品番(code)はブランドをまたいで重複しうる上、同一ブランド内でもシリーズをまたいで
// 再利用される(例: タミヤ X-1 はエナメル/アクリルミニ両方に存在)ため、
// 内部の一意キーは brand+series+code。
export function catalogCode(brand: string, series: string, code: string): string {
  return `${brand}|${series}|${code}`;
}
