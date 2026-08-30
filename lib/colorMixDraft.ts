export interface ColorMixPaint {
  paint_id: number;
  ratio: number;
  sort_order: number;
  name_ja: string;
  name_en: string | null;
  brand: string;
  series: string;
  series_en: string | null;
  code: string;
  hex: string | null;
  paint_type: string | null;
}

export interface ColorMixSummary {
  id: number;
  name: string | null;
  note: string | null;
  paints: ColorMixPaint[];
}

export interface MixDraftPaint extends Omit<ColorMixPaint, 'ratio' | 'sort_order'> {
  percentage: number;
}

export interface MixDraft {
  name: string;
  note: string;
  paints: MixDraftPaint[];
}

export function moveMixRecipe(
  recipes: ColorMixSummary[],
  recipeId: number,
  direction: -1 | 1,
): ColorMixSummary[] {
  const index = recipes.findIndex((recipe) => recipe.id === recipeId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= recipes.length) return recipes;
  const next = [...recipes];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export type MixDraftError = 'empty' | 'duplicate' | 'max_paints' | 'paint_type_mismatch' | 'invalid_hex' | 'invalid_percentage' | 'invalid_percentage_total';

const MAX_PAINTS = 5;

function isValidHex(hex: string | null): boolean {
  return typeof hex === 'string' && /^#?[0-9a-fA-F]{6}$/.test(hex);
}

function isValidPercentage(percentage: number): boolean {
  return Number.isInteger(percentage) && percentage >= 1 && percentage <= 100;
}

export function wholePercentagesFromRatios(weights: number[]): number[] {
  if (weights.length === 0) return [];
  const safeWeights = weights.map((weight) => Number.isFinite(weight) && weight > 0 ? weight : 0);
  const total = safeWeights.reduce((sum, weight) => sum + weight, 0);
  const exact = safeWeights.map((weight) => total > 0 ? (weight / total) * 100 : 100 / weights.length);
  const result = exact.map(Math.floor);
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  let remaining = 100 - result.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < remaining; index++) result[order[index % order.length].index] += 1;
  result.forEach((value, index) => {
    if (value !== 0) return;
    const donor = result.reduce((best, candidate, candidateIndex) => candidate > result[best] ? candidateIndex : best, 0);
    result[donor] -= 1;
    result[index] = 1;
  });
  return result;
}

function redistributeEvenly(paints: MixDraftPaint[]): MixDraftPaint[] {
  const percentages = wholePercentagesFromRatios(paints.map(() => 1));
  return paints.map((paint, index) => ({ ...paint, percentage: percentages[index] }));
}

export function tryAddDraftPaint(
  current: MixDraftPaint[],
  paint: Omit<MixDraftPaint, 'percentage'> & { percentage?: number },
): { paints: MixDraftPaint[]; error: MixDraftError | null } {
  if (current.some((item) => item.paint_id === paint.paint_id)) return { paints: current, error: 'duplicate' };
  if (current.length >= MAX_PAINTS) return { paints: current, error: 'max_paints' };
  if (current.length > 0 && current[0].paint_type !== paint.paint_type) {
    return { paints: current, error: 'paint_type_mismatch' };
  }
  if (!isValidHex(paint.hex)) return { paints: current, error: 'invalid_hex' };
  return { paints: redistributeEvenly([...current, { ...paint, percentage: 1 }]), error: null };
}

export function removeDraftPaint(current: MixDraftPaint[], paintId: number): MixDraftPaint[] {
  return redistributeEvenly(current.filter((paint) => paint.paint_id !== paintId));
}

export function validateMixDraft(draft: MixDraft): MixDraftError | null {
  if (draft.paints.length === 0) return 'empty';
  if (draft.paints.length > MAX_PAINTS) return 'max_paints';

  const seen = new Set<number>();
  const paintType = draft.paints[0].paint_type;
  for (const paint of draft.paints) {
    if (seen.has(paint.paint_id)) return 'duplicate';
    seen.add(paint.paint_id);
    if (paint.paint_type !== paintType) return 'paint_type_mismatch';
    if (!isValidHex(paint.hex)) return 'invalid_hex';
    if (!isValidPercentage(paint.percentage)) return 'invalid_percentage';
  }
  if (totalPercentage(draft.paints) !== 100) return 'invalid_percentage_total';
  return null;
}

export function normalizeDraftPaints(paints: MixDraftPaint[]): { paintId: number; ratio: number }[] {
  return paints.map((paint) => ({
    paintId: paint.paint_id,
    ratio: paint.percentage / 100,
  }));
}

export function totalPercentage(paints: MixDraftPaint[]): number {
  return paints.reduce((sum, paint) => sum + paint.percentage, 0);
}

export function draftFromSummary(summary?: ColorMixSummary | null): MixDraft {
  if (!summary) return { name: '', note: '', paints: [] };
  const percentages = wholePercentagesFromRatios(summary.paints.map((paint) => paint.ratio));
  return {
    name: summary.name ?? '',
    note: summary.note ?? '',
    paints: summary.paints.map(({ ratio, sort_order, ...paint }, index) => ({
      ...paint,
      percentage: percentages[index],
    })),
  };
}
