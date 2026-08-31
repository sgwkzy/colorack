import { getDB } from './connection';
import { getDefaultBoxId } from './settings';
import type { ListType, PaintStatus } from './types';

// 一覧表示用: 使用済を除いた所持数を paint_id ごとにまとめる。
export async function getOwnedCountMap(): Promise<Map<number, number>> {
  const rows = await getDB().getAllAsync<{ paint_id: number; n: number }>(
    "SELECT paint_id, COUNT(*) AS n FROM inventory WHERE status IN ('owned','in_use') GROUP BY paint_id"
  );
  return new Map(rows.map((r) => [r.paint_id, r.n]));
}

// 指定した塗料がお気に入り/買い物リストに登録済みかどうか。
export async function getListMembership(paintId: number): Promise<{ favorites: boolean; wishlist: boolean }> {
  const rows = await getDB().getAllAsync<{ type: ListType }>(
    "SELECT DISTINCT type FROM lists WHERE paint_id = ? AND type IN ('favorites','wishlist')",
    [paintId]
  );
  return {
    favorites: rows.some((r) => r.type === 'favorites'),
    wishlist: rows.some((r) => r.type === 'wishlist'),
  };
}

export async function removeFromList(paintId: number, type: ListType): Promise<void> {
  await getDB().runAsync('DELETE FROM lists WHERE paint_id = ? AND type = ?', [paintId, type]);
}

export async function moveWishlistPaintToBox(listId: number, paintId: number, boxId: number): Promise<number> {
  let inventoryId = 0;
  await getDB().withExclusiveTransactionAsync(async (tx) => {
    const inserted = await tx.runAsync(
      "INSERT INTO inventory (paint_id, status, box_id) VALUES (?, 'owned', ?)",
      [paintId, boxId]
    );
    const removed = await tx.runAsync(
      "DELETE FROM lists WHERE id = ? AND type = 'wishlist' AND paint_id = ?",
      [listId, paintId]
    );
    if (removed.changes !== 1) throw new Error('Wishlist item not found');
    inventoryId = inserted.lastInsertRowId;
  });
  return inventoryId;
}

export async function undoWishlistPaintMove(inventoryId: number, paintId: number): Promise<void> {
  await getDB().withExclusiveTransactionAsync(async (tx) => {
    const removed = await tx.runAsync('DELETE FROM inventory WHERE id = ? AND paint_id = ?', [inventoryId, paintId]);
    if (removed.changes !== 1) throw new Error('Moved inventory item not found');
    await tx.runAsync("INSERT OR IGNORE INTO lists (type, paint_id) VALUES ('wishlist', ?)", [paintId]);
  });
}

export interface InventoryDetail {
  id: number;
  paint_id: number;
  box_id: number | null;
  box_name: string | null;
  status: PaintStatus;
  note: string | null;
  added_at: string | null;
  status_changed_at: string | null;
  catalog_code: string;
  brand: string;
  series: string;
  series_en: string | null;
  code: string;
  name_ja: string;
  name_en: string | null;
  hex: string | null;
  gloss: string | null;
  paint_type: string | null;
  source: string;
  paint_notes: string | null;
}

export async function getInventoryDetail(inventoryId: number): Promise<InventoryDetail | null> {
  const row = await getDB().getFirstAsync<InventoryDetail>(
    'SELECT i.id, i.paint_id, i.box_id, b.name AS box_name, i.status, i.note, i.added_at, COALESCE(i.status_changed_at, i.added_at) AS status_changed_at,'
    + ' c.catalog_code, c.brand, c.series, c.series_en, c.code, c.name_ja, c.name_en, c.hex, c.gloss, c.paint_type, c.source, c.notes AS paint_notes'
    + ' FROM inventory i'
    + ' JOIN catalog_paints c ON i.paint_id = c.id'
    + ' LEFT JOIN boxes b ON i.box_id = b.id'
    + ' WHERE i.id = ?',
    [inventoryId]
  );
  return row ?? null;
}

// status_changed_at は「最終更新日時」として、ステータス変更に限らず
// メモ・ボックスの変更でも更新する(在庫1点の最終更新日時という位置づけ)。
export async function updateInventoryNote(inventoryId: number, note: string): Promise<void> {
  const normalized = note.trim() === '' ? null : note;
  await getDB().runAsync(
    "UPDATE inventory SET note = ?, status_changed_at = datetime('now') WHERE id = ?",
    [normalized, inventoryId]
  );
}

export async function updateInventoryBox(inventoryId: number, boxId: number): Promise<void> {
  await getDB().runAsync(
    "UPDATE inventory SET box_id = ?, status_changed_at = datetime('now') WHERE id = ?",
    [boxId, inventoryId]
  );
}

// boxId を渡すと、そのボックスへ入れて状態を変える(使用済みから在庫へ戻すときに
// 戻し先をユーザーが選ぶ用途)。ステータスとボックスを別々に更新すると途中で失敗した
// ときに「使用済みなのにボックスが入っている」中途半端な状態が残るため、1文で行う。
// boxId 未指定時は従来どおり、ボックス未所属ならデフォルトボックスへ入れる。
export async function setInventoryStatus(inventoryId: number, status: PaintStatus, boxId?: number): Promise<void> {
  if (status !== 'used_up' && boxId != null) {
    await getDB().runAsync(
      "UPDATE inventory SET status = ?, box_id = ?, status_changed_at = datetime('now') WHERE id = ?",
      [status, boxId, inventoryId]
    );
    return;
  }
  const defaultBoxId = status === 'used_up' ? null : await getDefaultBoxId();
  await getDB().runAsync(
    "UPDATE inventory SET status = ?, box_id = CASE WHEN ? = 'used_up' THEN NULL WHEN box_id IS NULL THEN ? ELSE box_id END, status_changed_at = datetime('now') WHERE id = ?",
    [status, status, defaultBoxId, inventoryId]
  );
}
