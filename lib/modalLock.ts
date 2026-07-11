import { useEffect, useReducer } from 'react';

let openCount = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function useModalLock(visible: boolean): void {
  useEffect(() => {
    if (!visible) return;
    openCount += 1;
    notify();
    return () => { openCount -= 1; notify(); };
  }, [visible]);
}

export function useModalOpen(): boolean {
  const [, force] = useReducer((value) => value + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return openCount > 0;
}
