import { useEffect, useReducer } from 'react';

export type ActiveBox = number | 'all';

let activeBox: ActiveBox = 'all';
const listeners = new Set<() => void>();

export function setActiveBox(next: ActiveBox): void {
  if (activeBox === next) return;
  activeBox = next;
  listeners.forEach((listener) => listener());
}

export function useActiveBox(): ActiveBox {
  const [, force] = useReducer((value) => value + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return activeBox;
}
