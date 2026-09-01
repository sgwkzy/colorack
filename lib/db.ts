export { catalogCode, type KitStatus, type ListType, type PaintStatus, type SeedRow } from './db/types';
export { getDB } from './db/connection';
export { initDB } from './db/schema';
export { getSetting, setSetting, getDefaultBoxId, getDefaultKitBoxId } from './db/settings';
export {
  resetCatalogToMaster, getCatalogAppliedVersion, applyCatalogUpdate, deletePaint,
  type CatalogPaintDetail, getCatalogPaintDetail, updateCatalogPaintNotes,
  type CatalogPaintContentEdit, updateCatalogPaintContent, type ManualPaintEdit,
  updateManualPaint, resetCatalogPaintToMaster,
} from './db/catalog';
export { getMasterCatalogPaint } from './db/seedCatalog';
export {
  getOwnedCountMap, getListMembership, removeFromList, type InventoryDetail,
  getInventoryDetail, updateInventoryNote, updateInventoryBox, setInventoryStatus,
  moveWishlistPaintToBox, undoWishlistPaintMove,
} from './db/inventory';
export {
  type KitDetail, getKitDetail, updateKitNote, updateKitName, updateKitMaker,
  updateKitScale, updateKitSeries, updateKitCategory, updateKitPrice, updateKitBox,
  setKitStatus, deleteKit,
} from './db/kits';
export { type KitPhoto, getKitPhotos, addKitPhoto, removeKitPhoto, reorderKitPhotos } from './db/kitPhotos';
export { getMixRecipes, addMixRecipe, updateMixRecipe, removeMixRecipe, reorderMixRecipes } from './db/mixRecipes';
export {
  type KitColorPaint, type KitColorSummary, getKitColors, addKitColor,
  addKitColorFromSummary, updateKitColor, removeKitColor, reorderKitColors,
} from './db/kitColors';
export {
  type KitWishlistColorSummary, type KitColorPaintInput, getKitWishlistColors,
  addKitWishlistColor, updateKitWishlistColor, removeKitWishlistColor, reorderKitWishlistColors,
} from './db/kitWishlistColors';
export {
  type KitWishlistItem, type KitWishlistPhoto, type KitWishlistSnapshot, type KitWishlistDraft, getKitWishlistPhotos,
  saveKitWishlistItem, addKitWishlistItem,
  removeKitWishlistItem, restoreKitWishlistItem,
  moveKitWishlistItemToBox, undoKitWishlistMove,
} from './db/kitWishlist';
