export type BoxSelectionPlan = { kind: 'unavailable' } | { kind: 'direct'; boxId: number } | { kind: 'choose' };

export function boxSelectionPlan(boxes: readonly { id: number }[]): BoxSelectionPlan {
  if (boxes.length === 0) return { kind: 'unavailable' };
  if (boxes.length === 1) return { kind: 'direct', boxId: boxes[0].id };
  return { kind: 'choose' };
}

export async function loadBoxSelectionPlan<T extends { id: number }>(loadBoxes: () => Promise<T[]>):
  Promise<{ boxes: T[]; plan: BoxSelectionPlan }> {
  const boxes = await loadBoxes();
  return { boxes, plan: boxSelectionPlan(boxes) };
}

export function acquireBoxSelectionLock(lock: { current: boolean }): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export async function withBoxSelectionLock<T>(lock: { current: boolean }, operation: () => Promise<T>): Promise<T | undefined> {
  if (!acquireBoxSelectionLock(lock)) return undefined;
  try {
    return await operation();
  } finally {
    lock.current = false;
  }
}
