import { useEffect, useReducer } from 'react';
import { setSetting } from './db';

export type ActiveBox = number | 'all';

let activeBox: ActiveBox = 'all';
const listeners = new Set<() => void>();
let boxesVersion = 0;
const boxListeners = new Set<() => void>();

export function setActiveBox(next: ActiveBox): void {
  if (activeBox === next) return;
  activeBox = next;
  listeners.forEach((listener) => listener());
  setSetting('last_box_id', String(next));
}

export function useActiveBox(): ActiveBox {
  const [, force] = useReducer((value) => value + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return activeBox;
}

export function notifyBoxesChanged(): void {
  boxesVersion += 1;
  boxListeners.forEach((listener) => listener());
}

export function useBoxesVersion(): number {
  const [, force] = useReducer((value) => value + 1, 0);
  useEffect(() => { boxListeners.add(force); return () => { boxListeners.delete(force); }; }, []);
  return boxesVersion;
}
