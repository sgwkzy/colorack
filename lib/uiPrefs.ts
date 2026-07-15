import { useEffect, useReducer } from 'react';
import { getSetting, setSetting } from './db';

export type FabSide = 'left' | 'right' | 'bottom';
export type ActionOrder = 'normal' | 'reverse';
export type ListFontSize = 'small' | 'medium' | 'large';

const FAB_SIDE_KEY = 'fab_side';
const LIST_FONT_SIZE_KEY = 'list_font_size';
const ACTION_ORDER_KEY = 'action_order';

let currentFabSide: FabSide = 'right';
let currentListFontSize: ListFontSize = 'medium';
let currentActionOrder: ActionOrder = 'normal';
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

export async function initUiPrefs(): Promise<void> {
  try {
    const [fabSide, listFontSize, actionOrder] = await Promise.all([
      getSetting(FAB_SIDE_KEY),
      getSetting(LIST_FONT_SIZE_KEY),
      getSetting(ACTION_ORDER_KEY),
    ]);
    if (fabSide === 'left' || fabSide === 'right' || fabSide === 'bottom') {
      currentFabSide = fabSide;
    }
    if (listFontSize === 'small' || listFontSize === 'medium' || listFontSize === 'large') {
      currentListFontSize = listFontSize;
    }
    if (actionOrder === 'normal' || actionOrder === 'reverse') currentActionOrder = actionOrder;
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

export function setActionOrder(order: ActionOrder): void {
  currentActionOrder = order;
  notify();
  setSetting(ACTION_ORDER_KEY, order).catch((e) => console.error('setActionOrder: failed to persist', e));
}

export function useUiPrefs(): { fabSide: FabSide; listFontSize: ListFontSize; actionOrder: ActionOrder } {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => { listeners.delete(force); };
  }, []);
  return { fabSide: currentFabSide, listFontSize: currentListFontSize, actionOrder: currentActionOrder };
}
