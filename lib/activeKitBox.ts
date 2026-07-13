import { useEffect, useReducer } from 'react';
import { setSetting } from './db';

export type ActiveKitBox = number | 'all';

let activeKitBox: ActiveKitBox = 'all';
const listeners = new Set<() => void>();
let kitBoxesVersion = 0;
const kitBoxListeners = new Set<() => void>();

export function setActiveKitBox(next: ActiveKitBox): void {
  if (activeKitBox === next) return;
  activeKitBox = next;
  listeners.forEach((listener) => listener());
  setSetting('last_kit_box_id', String(next));
}

export function useActiveKitBox(): ActiveKitBox {
  const [, force] = useReducer((value) => value + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return activeKitBox;
}

export function notifyKitBoxesChanged(): void {
  kitBoxesVersion += 1;
  kitBoxListeners.forEach((listener) => listener());
}

export function useKitBoxesVersion(): number {
  const [, force] = useReducer((value) => value + 1, 0);
  useEffect(() => { kitBoxListeners.add(force); return () => { kitBoxListeners.delete(force); }; }, []);
  return kitBoxesVersion;
}
