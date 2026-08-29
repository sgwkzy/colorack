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
  parts: number;
}

export interface MixDraft {
  name: string;
  note: string;
  paints: MixDraftPaint[];
}

export type MixDraftError = 'empty' | 'duplicate' | 'max_paints' | 'paint_type_mismatch' | 'invalid_hex' | 'invalid_parts';

const MAX_PAINTS = 5;

function isValidHex(hex: string | null): boolean {
  return typeof hex === 'string' && /^#?[0-9a-fA-F]{6}$/.test(hex);
}

function isValidParts(parts: number): boolean {
  return Number.isInteger(parts) && parts >= 1 && parts <= 9999;
}

export function tryAddDraftPaint(
  current: MixDraftPaint[],
  paint: Omit<MixDraftPaint, 'parts'> & { parts?: number },
): { paints: MixDraftPaint[]; error: MixDraftError | null } {
  if (current.some((item) => item.paint_id === paint.paint_id)) return { paints: current, error: 'duplicate' };
  if (current.length >= MAX_PAINTS) return { paints: current, error: 'max_paints' };
  if (current.length > 0 && current[0].paint_type !== paint.paint_type) {
    return { paints: current, error: 'paint_type_mismatch' };
  }
  if (!isValidHex(paint.hex)) return { paints: current, error: 'invalid_hex' };
  return { paints: [...current, { ...paint, parts: 1 }], error: null };
}

export function removeDraftPaint(current: MixDraftPaint[], paintId: number): MixDraftPaint[] {
  return current.filter((paint) => paint.paint_id !== paintId);
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
    if (!isValidParts(paint.parts)) return 'invalid_parts';
  }
  return null;
}

export function normalizeDraftPaints(paints: MixDraftPaint[]): { paintId: number; ratio: number }[] {
  const total = paints.reduce((sum, paint) => sum + paint.parts, 0);
  return paints.map((paint) => ({
    paintId: paint.paint_id,
    ratio: total > 0 ? paint.parts / total : 0,
  }));
}

export function normalizedPercent(paints: MixDraftPaint[], paintId: number): number {
  const total = paints.reduce((sum, paint) => sum + paint.parts, 0);
  const paint = paints.find((item) => item.paint_id === paintId);
  return paint && total > 0 ? (paint.parts / total) * 100 : 0;
}

export function draftFromSummary(summary?: ColorMixSummary | null): MixDraft {
  if (!summary) return { name: '', note: '', paints: [] };
  return {
    name: summary.name ?? '',
    note: summary.note ?? '',
    paints: summary.paints.map(({ ratio, sort_order, ...paint }) => ({
      ...paint,
      parts: Math.max(1, Math.round(ratio * 100)),
    })),
  };
}
