import { useEffect, useReducer } from 'react';
import { getSetting, setSetting } from './db';

export type FabSide = 'left' | 'right' | 'bottom';
export type ListFontSize = 'small' | 'medium' | 'large';

const FAB_SIDE_KEY = 'fab_side';
const LIST_FONT_SIZE_KEY = 'list_font_size';

let currentFabSide: FabSide = 'right';
let currentListFontSize: ListFontSize = 'medium';
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

export async function initUiPrefs(): Promise<void> {
  try {
    const [fabSide, listFontSize] = await Promise.all([
      getSetting(FAB_SIDE_KEY),
      getSetting(LIST_FONT_SIZE_KEY),
    ]);
    if (fabSide === 'left' || fabSide === 'right' || fabSide === 'bottom') {
      currentFabSide = fabSide;
    }
    if (listFontSize === 'small' || listFontSize === 'medium' || listFontSize === 'large') {
      currentListFontSize = listFontSize;
    }
  } catch (e) {
    console.error('initUiPrefs: failed to load UI preferences, falling back to defaults', e);
  }
}

export function setFabSide(side: FabSide): void {
  currentFabSide = side;
  notify();
  setSetting(FAB_SIDE_KEY, side).catch((e) => console.error('setFabSide: failed to persist', e));
}

export function setListFontSize(size: ListFontSize): void {
  currentListFontSize = size;
  notify();
  setSetting(LIST_FONT_SIZE_KEY, size).catch((e) => console.error('setListFontSize: failed to persist', e));
}

export function useUiPrefs(): { fabSide: FabSide; listFontSize: ListFontSize } {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => { listeners.delete(force); };
  }, []);
  return { fabSide: currentFabSide, listFontSize: currentListFontSize };
}
