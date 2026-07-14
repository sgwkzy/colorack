# Last-Screen/Box Restore + Drawer Preview Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the last-viewed box screen (paint/kit, specific box ID, including 使用済み/完成品) on app cold start, keep the drawer's Colorack/Kitrack mode always in sync with whichever screen is actually being viewed, and make the drawer's manual mode toggle a preview-only affordance that reverts if the user closes the drawer without navigating.

**Architecture:** A new small module (`lib/lastScreen.ts`) persists "which screen + which box" via the existing `app_settings` SQLite table (same mechanism as `default_box_id`/`appMode`). `owned.tsx`/`kits.tsx` write to it on every focus (and, via the existing `setActiveBox`/`setActiveKitBox`, on every box switch). On cold start, `app/(tabs)/_layout.tsx` reads the restore target synchronously (already loaded during the app's init sequence) and passes it to `<Tabs>` as `initialRouteName`/`initialParams` — this mounts the correct screen directly, with no flash, and reuses `owned.tsx`/`kits.tsx`'s existing `boxId`-URL-param restoration logic unchanged. `NavigationDrawer.tsx` gains a local `previewMode` state that resyncs to the real, screen-derived `appMode` every time the drawer opens, so a toggle tap that isn't followed by actually navigating into a box doesn't stick.

**Tech Stack:** Same as prior plans on this branch (Expo SDK ~54 / React Native / expo-sqlite / expo-router). No new dependencies.

## Global Constraints

- No test framework exists in this project. Verification is `npx tsc --noEmit` plus documented manual Expo Go checks.
- No UTF-8 BOM in any modified file.
- Restoration scope is limited to `owned`/`used`/`kits`/`completed` screens. Favorites/wishlist/catalog/settings never update `last_screen` — visiting them leaves whichever box screen was last active as the restore anchor.
- No modal open/close state is restored (out of scope) — the app always cold-starts with all modals closed.
- `app_settings` is the only persistence mechanism for this feature (no `AsyncStorage`, matching this codebase's established convention).
- The dynamic-`initialRouteName` approach must not introduce a visible flash of the wrong screen on cold start — `<Tabs>` must mount directly on the restored screen, not mount `owned` then redirect.

---

### Task 1: `lib/lastScreen.ts` (new module)

**Files:**
- Create: `lib/lastScreen.ts`

**Interfaces:**
- Consumes: `getSetting`, `setSetting` from `../lib/db` (both already exist).
- Produces: `LastScreen` type (`'owned' | 'used' | 'kits' | 'completed'`), `initLastScreen(): Promise<void>`, `getRestoreTarget(): { screen: LastScreen; boxId: string | null } | null`, `setLastScreen(screen: LastScreen): void`.
- Consumed by: Task 3 (`app/_layout.tsx`), Task 4 (`owned.tsx`/`kits.tsx`), Task 5 (`app/(tabs)/_layout.tsx`).

- [ ] **Step 1: Create the file**

```ts
// lib/lastScreen.ts
// 起動時に「最後に開いていた画面+ボックス」を復元するための永続化。
// lib/appMode.ts と同じく app_settings をバックエンドに使うが、こちらは
// 起動時に一度読み込んで同期的に参照するだけなので、購読フック(useReducer)は不要。
import { getSetting, setSetting } from './db';

export type LastScreen = 'owned' | 'used' | 'kits' | 'completed';

let lastScreen: LastScreen | null = null;
let lastBoxId: string | null = null;
let lastKitBoxId: string | null = null;

export async function initLastScreen(): Promise<void> {
  const [screen, boxId, kitBoxId] = await Promise.all([
    getSetting('last_screen'),
    getSetting('last_box_id'),
    getSetting('last_kit_box_id'),
  ]);
  if (screen === 'owned' || screen === 'used' || screen === 'kits' || screen === 'completed') lastScreen = screen;
  lastBoxId = boxId;
  lastKitBoxId = kitBoxId;
}

export function getRestoreTarget(): { screen: LastScreen; boxId: string | null } | null {
  if (!lastScreen) return null;
  const boxId = lastScreen === 'owned' ? lastBoxId : lastScreen === 'kits' ? lastKitBoxId : null;
  return { screen: lastScreen, boxId };
}

export function setLastScreen(screen: LastScreen): void {
  if (lastScreen === screen) return;
  lastScreen = screen;
  setSetting('last_screen', screen);
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `lib/lastScreen.ts`.

Also verify no BOM: `head -c 3 lib/lastScreen.ts | od -An -tx1` must not show `ef bb bf`.

- [ ] **Step 3: Commit**

```bash
git add lib/lastScreen.ts
git commit -m "feat: add lib/lastScreen.ts for restoring the last-viewed screen on launch"
```

---

### Task 2: Persist last active box in `lib/activeBox.ts`/`lib/activeKitBox.ts`

**Files:**
- Modify: `lib/activeBox.ts`
- Modify: `lib/activeKitBox.ts`

**Interfaces:**
- Consumes: `setSetting` from `./db` (already exists).
- No change to either module's existing exported signatures (`setActiveBox`, `useActiveBox`, `notifyBoxesChanged`, `useBoxesVersion` / the kit-box equivalents) — this task only adds a persistence side-effect inside the existing setters.

- [ ] **Step 1: Add persistence to `lib/activeBox.ts`**

Find:

```ts
import { useEffect, useReducer } from 'react';

export type ActiveBox = number | 'all';

let activeBox: ActiveBox = 'all';
const listeners = new Set<() => void>();
let boxesVersion = 0;
const boxListeners = new Set<() => void>();

export function setActiveBox(next: ActiveBox): void {
  if (activeBox === next) return;
  activeBox = next;
  listeners.forEach((listener) => listener());
}
```

Replace with:

```ts
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
```

- [ ] **Step 2: Add persistence to `lib/activeKitBox.ts`**

Find:

```ts
import { useEffect, useReducer } from 'react';

export type ActiveKitBox = number | 'all';

let activeKitBox: ActiveKitBox = 'all';
const listeners = new Set<() => void>();
let kitBoxesVersion = 0;
const kitBoxListeners = new Set<() => void>();

export function setActiveKitBox(next: ActiveKitBox): void {
  if (activeKitBox === next) return;
  activeKitBox = next;
  listeners.forEach((listener) => listener());
}
```

Replace with:

```ts
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
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to either file.

Also verify no BOM in both files.

- [ ] **Step 4: Commit**

```bash
git add lib/activeBox.ts lib/activeKitBox.ts
git commit -m "feat: persist last active box/kit box on every selection change"
```

---

### Task 3: Wire `initLastScreen()` into the app's startup sequence

**Files:**
- Modify: `app/_layout.tsx`

**Interfaces:**
- Consumes: `initLastScreen` from `../lib/lastScreen` (Task 1).

- [ ] **Step 1: Import `initLastScreen`**

Find:

```tsx
import { initAppMode } from '../lib/appMode';
import { initDB } from '../lib/db';
import { initTheme, useTheme } from '../lib/theme';
import { initLocale } from '../lib/i18n';
import { initUiPrefs } from '../lib/uiPrefs';
```

Replace with:

```tsx
import { initAppMode } from '../lib/appMode';
import { initDB } from '../lib/db';
import { initTheme, useTheme } from '../lib/theme';
import { initLocale } from '../lib/i18n';
import { initLastScreen } from '../lib/lastScreen';
import { initUiPrefs } from '../lib/uiPrefs';
```

- [ ] **Step 2: Add `initLastScreen()` to the init `Promise.all`**

Find:

```tsx
        await initDB();
        await Promise.all([initTheme(), initLocale(), initUiPrefs(), initAppMode()]);
```

Replace with:

```tsx
        await initDB();
        await Promise.all([initTheme(), initLocale(), initUiPrefs(), initAppMode(), initLastScreen()]);
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `app/_layout.tsx`.

- [ ] **Step 4: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat: load last-screen restore state during app init"
```

---

### Task 4: `owned.tsx`/`kits.tsx` — sync `last_screen`/`appMode` on focus

**Files:**
- Modify: `app/(tabs)/owned.tsx`
- Modify: `app/(tabs)/kits.tsx`

**Interfaces:**
- Consumes: `setLastScreen` from `../../lib/lastScreen` (Task 1); `setAppMode` from `../../lib/appMode` (already exists, not previously imported by these two files).

- [ ] **Step 1: `owned.tsx` — add imports**

Find:

```tsx
import { getDB, getDefaultBoxId, getListMembership, PaintStatus, setInventoryStatus } from '../../lib/db';
import { setActiveBox } from '../../lib/activeBox';
import { t, useLocale } from '../../lib/i18n';
```

Replace with:

```tsx
import { getDB, getDefaultBoxId, getListMembership, PaintStatus, setInventoryStatus } from '../../lib/db';
import { setActiveBox } from '../../lib/activeBox';
import { setAppMode } from '../../lib/appMode';
import { t, useLocale } from '../../lib/i18n';
import { setLastScreen } from '../../lib/lastScreen';
```

- [ ] **Step 2: `owned.tsx` — add the focus effect**

Find:

```tsx
  useEffect(() => { if (!isUsedScreen) setActiveBox(selected); }, [isUsedScreen, selected]);

  useEffect(() => {
    if (isUsedScreen) return;
    if (selected === 'all') {
```

Replace with:

```tsx
  useEffect(() => { if (!isUsedScreen) setActiveBox(selected); }, [isUsedScreen, selected]);

  // 実際にこの画面が表示された時点で、起動時復元先とドロワーのモードを常に一致させる。
  useFocusEffect(useCallback(() => {
    setLastScreen(isUsedScreen ? 'used' : 'owned');
    setAppMode('colorack');
  }, [isUsedScreen]));

  useEffect(() => {
    if (isUsedScreen) return;
    if (selected === 'all') {
```

- [ ] **Step 3: `kits.tsx` — add imports**

Find:

```tsx
import { getDB, getDefaultKitBoxId, KitStatus } from '../../lib/db';
import { setActiveKitBox } from '../../lib/activeKitBox';
import { t, useLocale } from '../../lib/i18n';
```

Replace with:

```tsx
import { getDB, getDefaultKitBoxId, KitStatus } from '../../lib/db';
import { setActiveKitBox } from '../../lib/activeKitBox';
import { setAppMode } from '../../lib/appMode';
import { t, useLocale } from '../../lib/i18n';
import { setLastScreen } from '../../lib/lastScreen';
```

- [ ] **Step 4: `kits.tsx` — add the focus effect**

Find:

```tsx
  useEffect(() => { if (!completedScreen) setActiveKitBox(selected); }, [completedScreen, selected]);

  useEffect(() => {
    if (completedScreen) {
      navigation.setOptions({ title: t('completedKits') });
```

Replace with:

```tsx
  useEffect(() => { if (!completedScreen) setActiveKitBox(selected); }, [completedScreen, selected]);

  // 実際にこの画面が表示された時点で、起動時復元先とドロワーのモードを常に一致させる。
  useFocusEffect(useCallback(() => {
    setLastScreen(completedScreen ? 'completed' : 'kits');
    setAppMode('kitrack');
  }, [completedScreen]));

  useEffect(() => {
    if (completedScreen) {
      navigation.setOptions({ title: t('completedKits') });
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to either file.

- [ ] **Step 6: Commit**

```bash
git add "app/(tabs)/owned.tsx" "app/(tabs)/kits.tsx"
git commit -m "feat: sync last_screen and drawer mode whenever owned/kits gains focus"
```

---

### Task 5: `app/(tabs)/_layout.tsx` — dynamic initial route on cold start

**Files:**
- Modify: `app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `getRestoreTarget` from `../../lib/lastScreen` (Task 1).

- [ ] **Step 1: Import `getRestoreTarget`**

Find:

```tsx
import { t, useLocale } from '../../lib/i18n';
import { useTheme } from '../../lib/theme';
```

Replace with:

```tsx
import { t, useLocale } from '../../lib/i18n';
import { getRestoreTarget } from '../../lib/lastScreen';
import { useTheme } from '../../lib/theme';
```

- [ ] **Step 2: Compute the restore target and wire it into `<Tabs>`**

Find:

```tsx
  const drawerRef = useRef<DrawerLayout>(null);
  const { width } = useWindowDimensions();
  return (
    <DrawerLayout
      ref={drawerRef}
      drawerWidth={Math.min(360, width * 0.82)}
      drawerPosition="left"
      drawerType="front"
      edgeWidth={48}
      overlayColor="transparent"
      drawerBackgroundColor={colors.surface}
      drawerLockMode={modalOpen ? 'locked-closed' : 'unlocked'}
      onDrawerStateChanged={(_state, willShow) => { if (willShow) setDrawerOpen(true); }}
      onDrawerOpen={() => setDrawerOpen(true)}
      onDrawerClose={() => setDrawerOpen(false)}
      renderNavigationView={() => <NavigationDrawer visible={drawerOpen} onClose={() => drawerRef.current?.closeDrawer()} />}
    >
    <Tabs screenOptions={{
      tabBarActiveTintColor: colors.primary,
      tabBarStyle: { display: 'none' },
      tabBarInactiveTintColor: colors.textFaint,
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.text,
      headerShadowVisible: !isDark,
      headerLeft: () => <TouchableOpacity onPress={() => drawerRef.current?.openDrawer()} accessibilityRole="button" accessibilityLabel="Menu" hitSlop={12} style={{ marginLeft: 16 }}><IconMenu3 color={colors.text} size={26} /></TouchableOpacity>,
    }}>
      <Tabs.Screen name="owned" options={{ headerTitle: () => <BoxTitlePicker />, headerRight: () => <BoxOptions /> }} />
      <Tabs.Screen name="kits" options={{ headerTitle: () => <KitBoxTitlePicker />, headerRight: () => <KitBoxOptions /> }} />
      <Tabs.Screen name="used" options={{ title: t('statusUsedUp') }} />
```

Replace with:

```tsx
  const drawerRef = useRef<DrawerLayout>(null);
  const { width } = useWindowDimensions();
  const restoreTarget = getRestoreTarget();
  return (
    <DrawerLayout
      ref={drawerRef}
      drawerWidth={Math.min(360, width * 0.82)}
      drawerPosition="left"
      drawerType="front"
      edgeWidth={48}
      overlayColor="transparent"
      drawerBackgroundColor={colors.surface}
      drawerLockMode={modalOpen ? 'locked-closed' : 'unlocked'}
      onDrawerStateChanged={(_state, willShow) => { if (willShow) setDrawerOpen(true); }}
      onDrawerOpen={() => setDrawerOpen(true)}
      onDrawerClose={() => setDrawerOpen(false)}
      renderNavigationView={() => <NavigationDrawer visible={drawerOpen} onClose={() => drawerRef.current?.closeDrawer()} />}
    >
    <Tabs
      initialRouteName={restoreTarget?.screen}
      screenOptions={{
      tabBarActiveTintColor: colors.primary,
      tabBarStyle: { display: 'none' },
      tabBarInactiveTintColor: colors.textFaint,
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.text,
      headerShadowVisible: !isDark,
      headerLeft: () => <TouchableOpacity onPress={() => drawerRef.current?.openDrawer()} accessibilityRole="button" accessibilityLabel="Menu" hitSlop={12} style={{ marginLeft: 16 }}><IconMenu3 color={colors.text} size={26} /></TouchableOpacity>,
    }}>
      <Tabs.Screen
        name="owned"
        initialParams={restoreTarget?.screen === 'owned' && restoreTarget.boxId ? { boxId: restoreTarget.boxId } : undefined}
        options={{ headerTitle: () => <BoxTitlePicker />, headerRight: () => <BoxOptions /> }}
      />
      <Tabs.Screen
        name="kits"
        initialParams={restoreTarget?.screen === 'kits' && restoreTarget.boxId ? { boxId: restoreTarget.boxId } : undefined}
        options={{ headerTitle: () => <KitBoxTitlePicker />, headerRight: () => <KitBoxOptions /> }}
      />
      <Tabs.Screen name="used" options={{ title: t('statusUsedUp') }} />
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors attributable to `app/(tabs)/_layout.tsx`.

- [ ] **Step 4: Commit**

```bash
git add "app/(tabs)/_layout.tsx"
git commit -m "feat: restore last-viewed screen/box as the initial route on launch"
```

---

### Task 6: `NavigationDrawer.tsx` — preview-only mode toggle

**Files:**
- Modify: `components/NavigationDrawer.tsx`

**Interfaces:**
- Consumes: `AppMode`, `useAppMode` from `../lib/appMode` (unchanged; `setAppMode` is no longer imported/used by this file — the real mode is now set exclusively by `owned.tsx`/`kits.tsx`'s focus effects from Task 4).
- No change to this component's own exported `Props` shape (`{ visible, onClose }`).

- [ ] **Step 1: Drop the now-unused `setAppMode` import**

Find:

```tsx
import { AppMode, setAppMode, useAppMode } from '../lib/appMode';
```

Replace with:

```tsx
import { AppMode, useAppMode } from '../lib/appMode';
```

- [ ] **Step 2: Introduce local `previewMode` state that resyncs on open**

Find:

```tsx
  const pathname = usePathname();
  const mode = useAppMode();
  const activeBoxId = useActiveBox();
```

Replace with:

```tsx
  const pathname = usePathname();
  const appMode = useAppMode();
  const [previewMode, setPreviewMode] = useState<AppMode>(appMode);
  // ドロワーを開くたびに本当のモード(実際に表示中の画面)へ同期し直す。閉じている間に
  // トグルだけして実際にはボックスへ移動しなかった場合、次に開いた時は元のモードに戻る。
  useEffect(() => { if (visible) setPreviewMode(appMode); }, [visible, appMode]);
  const mode = previewMode;
  const activeBoxId = useActiveBox();
```

- [ ] **Step 3: Make the toggle change only the preview state**

Find:

```tsx
              <TouchableOpacity onPress={() => setAppMode(otherMode)} hitSlop={8} accessibilityRole="button" accessibilityLabel={otherModeLabel}>
```

Replace with:

```tsx
              <TouchableOpacity onPress={() => setPreviewMode(otherMode)} hitSlop={8} accessibilityRole="button" accessibilityLabel={otherModeLabel}>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: zero errors project-wide (this is the last task in the plan).

Also verify no BOM.

- [ ] **Step 5: Commit**

```bash
git add components/NavigationDrawer.tsx
git commit -m "feat: make the drawer's Colorack/Kitrack toggle preview-only"
```

- [ ] **Step 6: Manual verification checklist (Expo Go)**

This is the final task — after this, the feature is complete. On a real device (reload the app fully first, since the restore logic runs at startup):

1. Open a specific paint box (not "すべてのボックス"). Fully close/kill the app. Reopen it — confirm it launches directly into that same paint box (not the default box), with the header showing the correct box name.
2. Open a specific kit box. Fully close/kill the app. Reopen it — confirm it launches directly into that kit box, and the drawer (when opened) shows Kitrack mode with the "Colorack" switch link.
3. Open the 使用済み(used) screen. Close/reopen the app — confirm it launches into 使用済み.
4. Open the 完成品(completed) screen. Close/reopen the app — confirm it launches into 完成品, drawer in Kitrack mode.
5. Open お気に入り(favorites), then close/reopen the app — confirm it launches into whichever box screen was open *before* favorites (favorites itself is not a restore target).
6. While viewing a paint box, open the drawer, tap "Kitrack" (previewing the kit-box list), then close the drawer *without* tapping into any kit box. Reopen the drawer — confirm it shows Colorack again (matching the still-active paint box screen behind it).
7. Repeat step 6 but this time actually tap a kit box while previewing Kitrack — confirm it navigates to that kit box and the drawer mode is now genuinely Kitrack (persists across a subsequent drawer open/close and app restart).

## Self-Review Notes

- **Spec coverage:** 起動時のボックス/画面復元(Tasks 1, 3, 4, 5)✓; ドロワーモードの自動同期(Task 4の`setAppMode`呼び出し)✓; ドロワートグルのプレビュー専用化(Task 6)✓; お気に入り等を復元対象に含めないスコープ境界(Task 4は`owned.tsx`/`kits.tsx`のみに`setLastScreen`を追加し、他の画面には追加しないことで自然に満たされる)✓。
- **Type consistency:** `LastScreen`(Task 1)の4値は、Task 5の`Tabs.Screen name`(`owned`/`kits`/`used`/`completed`)と一致。`getRestoreTarget()`の戻り値`{ screen, boxId: string | null }`は、Task 5の`initialParams`が`boxId: string`型を期待する`useLocalSearchParams<{ boxId?: string }>()`(`owned.tsx`/`kits.tsx`で既存)と一致。`setAppMode('colorack'|'kitrack')`(Task 4)は`lib/appMode.ts`の既存の`AppMode`型と一致。
- **No placeholders:** every step has complete, runnable code.
