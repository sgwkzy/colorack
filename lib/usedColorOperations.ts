import type { KitColorSummary } from './db';

export interface UsedColorRepository {
  load(): Promise<KitColorSummary[]>;
  add(name: string | null, note: string | null, paints: { paintId: number; ratio: number }[]): Promise<void>;
  update(colorId: number, name: string | null, note: string | null, paints: { paintId: number; ratio: number }[]): Promise<void>;
  remove(colorId: number): Promise<void>;
  reorder(colorIds: number[]): Promise<void>;
}

export type UsedColorLoadResult =
  | { ok: true; colors: KitColorSummary[] }
  | { ok: false; error: unknown };

export async function loadUsedColors(repository: UsedColorRepository): Promise<UsedColorLoadResult> {
  try {
    return { ok: true, colors: await repository.load() };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function addUsedColor(
  repository: UsedColorRepository,
  name: string | null,
  note: string | null,
  paints: { paintId: number; ratio: number }[],
): Promise<UsedColorLoadResult> {
  await repository.add(name, note, paints);
  return loadUsedColors(repository);
}

export async function updateUsedColor(
  repository: UsedColorRepository,
  colorId: number,
  name: string | null,
  note: string | null,
  paints: { paintId: number; ratio: number }[],
): Promise<UsedColorLoadResult> {
  await repository.update(colorId, name, note, paints);
  return loadUsedColors(repository);
}

export async function removeUsedColor(
  repository: UsedColorRepository,
  colorId: number,
  onRemoved: () => void,
): Promise<UsedColorLoadResult> {
  await repository.remove(colorId);
  onRemoved();
  return loadUsedColors(repository);
}

export async function reorderUsedColors(
  repository: UsedColorRepository,
  previous: KitColorSummary[],
  next: KitColorSummary[],
) {
  try {
    await repository.reorder(next.map((color) => color.id));
    return { ok: true as const, colors: next };
  } catch (error) {
    return { ok: false as const, colors: previous, error };
  }
}
