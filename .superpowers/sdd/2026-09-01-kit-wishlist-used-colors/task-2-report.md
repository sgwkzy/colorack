# Task 2 report: transactional wishlist color lifecycle

## Implementation

- Extended `KitWishlistSnapshot` with candidate color snapshots and component-paint snapshots.
- Added one transaction-scoped reader for candidate colors and paints. It reads only `kit_wishlist_colors` and `kit_wishlist_color_paints`, preserves `sort_order`/`added_at`, and does not use catalog display joins.
- Box move now copies candidate colors into independent `kit_colors` rows and component paints into `kit_color_paints` using each new parent `lastInsertRowId`.
- Candidate deletion and move cleanup delete candidate color paints before candidate colors, then photos, then the candidate parent.
- Delete Undo and move Undo restore candidate colors and component paints with newly generated candidate-color IDs. Move Undo removes the created owned kit’s color children before its color parents, photos, and kit row.
- All metadata, photos, colors, and component paints remain inside the existing exclusive transaction for each operation; failures propagate so the transaction can roll back as one unit.

## Changed files

- `lib/db/kitWishlist.ts`
- `lib/kitWishlist.test.cjs`
- `.superpowers/sdd/2026-09-01-kit-wishlist-used-colors/task-2-report.md`

No dependencies, schema files, UI files, or unrelated plan artifacts were changed.

## TDD evidence

1. Added a literal two-color fixture: one single-paint color and one two-paint mix, including metadata, `sort_order`, `added_at`, ratios, and paint order.
2. RED: `node --test lib/kitWishlist.test.cjs` failed with 6 expected failures because the pre-change implementation omitted colors and issued no color-copy/restore SQL.
3. GREEN: the same command passed with 30/30 tests after the minimal implementation.
4. Added rollback behavior tests for move, restore, and move Undo. Each injects a color-paint insert failure and verifies the modeled transaction state remains unchanged and is not committed.

## Test results

- `node --test lib/kitWishlist.test.cjs`: 30 passed, 0 failed.
- `npm run test`: 154 passed, 0 failed.
- `npm run typecheck`: exit 0.
- `git diff --check`: passed; only Git’s existing LF/CRLF normalization warnings were emitted.

## Transaction boundaries

| Operation | Exclusive transaction contents |
| --- | --- |
| Candidate → Box | Read item/photos/colors; insert owned kit/photos/colors/paints; delete candidate color paints/colors/photos/item. |
| Candidate delete | Read item/photos/colors; delete candidate color paints/colors/photos/item. |
| Candidate restore | Insert candidate/item metadata, photos, colors, and component paints. |
| Move Undo | Delete the exact owned kit’s color paints/colors/photos/kit; insert candidate metadata, photos, colors, and component paints. |

The snapshot reader receives the transaction handle, so the snapshot and every subsequent write observe one SQLite transaction. A thrown insert prevents the callback from completing and leaves no committed partial rows in the rollback tests.

## Requirement decisions

- Candidate and owned color tables stay independent; only values are transferred, never the old parent IDs or a lasting link.
- `lastInsertRowId` is used for every new color parent so child rows point to the newly created record.
- Existing file-cleanup behavior is preserved: move Undo does not delete photo files.
- Candidate color reset/catalog-reference handling is intentionally out of scope for Task 2 and remains for the planned Task 3.

## Remaining concerns

- No Expo device/runtime test was run; rollback evidence is from the Node behavioral doubles and TypeScript validation. A device smoke test remains useful when the UI flow is exercised.
- Task 3 still needs to include candidate color rows in reset and catalog-reference safety paths.

## Commit

Commit SHA: pending after commit.
