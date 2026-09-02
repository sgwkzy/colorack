# Kit Color Parent Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent a used-color record from being created for a deleted or nonexistent kit, including the race between kit deletion and used-color creation.

**Architecture:** Make `addKitColor` follow the existing purchase-candidate color pattern: run the complete operation in `withExclusiveTransactionAsync`, verify the parent `kits` row inside that transaction, then calculate the order and insert the parent/child rows through the transaction handle. No schema change is needed because the application-level guard closes the confirmed write path.

**Tech Stack:** TypeScript, Expo SQLite, Node's built-in test runner, the existing transpile-based `kitColors.test.cjs` harness.

## Global Constraints

- Modify only `lib/db/kitColors.ts` and `lib/kitColors.test.cjs` in this plan.
- Keep the existing `addKitColor` and `addKitColorFromSummary` signatures and normalized metadata behavior.
- Preserve child-row ordering, ratios, transaction atomicity, and all existing update/remove/reorder behavior.
- Do not add foreign-key migrations, dependencies, unrelated refactors, or UI changes.
- Follow test-first development: add a regression test and verify it fails against the current implementation before changing production code.
- Preserve unrelated user changes, the separate photo-authority work, and all other worktrees.

---

## Task 1: Add a failing parent-guard regression test

**Files:** `lib/kitColors.test.cjs`

- [x] Update only the add-color test fixtures that need it so they expose `withExclusiveTransactionAsync` while retaining existing fixtures for update behavior.
- [x] Add one test named `add kit color rejects a missing kit before writing any rows` that provides both transaction methods, returns no row for `SELECT id FROM kits WHERE id = ?`, and asserts:
  - the exclusive transaction method is used;
  - `addKitColor` rejects with `Kit not found`;
  - no `INSERT INTO kit_colors` or `INSERT INTO kit_color_paints` statement is recorded.
- [x] Keep the test focused on observable database behavior and use the current `node:test`/`assert/strict` style. Do not modify production code in this task.
- [x] Run `node --test lib/kitColors.test.cjs` and confirm the new test fails because the current implementation uses the non-exclusive transaction and writes without checking the kit parent.

The implementer must write the full report to `.superpowers/sdd/2026-09-02-kit-color-parent-guard/task-1-report.md` with changed files, exact command/output, and concerns. Return only status, commits if any, one-line test summary, and concerns. Do not spawn subagents or reviewers.

## Task 2: Guard the production write at the SQLite boundary

**Files:** `lib/db/kitColors.ts`

- [x] Change `addKitColor` to call `db.withExclusiveTransactionAsync(async (tx) => { ... })`.
- [x] As the first query inside that transaction, execute:

```ts
const kit = await tx.getFirstAsync<{ id: number }>(
  'SELECT id FROM kits WHERE id = ?',
  [kitId]
);
if (!kit) throw new Error('Kit not found');
```

- [x] Use `tx` (not the outer `db`) for the sort-order query, the `kit_colors` insert, and every `kit_color_paints` insert.
- [x] Leave `addKitColorFromSummary` as a delegating wrapper and do not change signatures or metadata normalization.
- [x] Run `node --test lib/kitColors.test.cjs` and confirm the new regression and all existing kit-color tests pass.
- [x] Run `npm run typecheck`.

The implementer must append a fix/report summary to `.superpowers/sdd/2026-09-02-kit-color-parent-guard/task-2-report.md` with exact command/output and concerns. Return only status, commits if any, one-line test summary, and concerns. Do not spawn subagents or reviewers.

## Task 3: Verify the focused and repository-wide regression surface

**Files:** no additional files.

- [x] Run `npm run test`.
- [x] Run `npm run typecheck`.
- [x] Run `git diff --check`.
- [x] Review the final diff to confirm the only production behavior change is the parent check/exclusive transaction for `addKitColor`, with no schema or dependency changes.
- [x] Record any remaining release review findings separately; do not claim the broader release is ready from this focused fix alone.

## Definition of Done

- [x] Adding a color for an existing kit still stores normalized metadata and ordered child paints.
- [x] Adding a color for a missing/deleted kit rejects before writing either parent or child rows.
- [x] The parent check and all writes are serialized in one exclusive transaction.
- [x] The focused and repository-wide checks pass.
