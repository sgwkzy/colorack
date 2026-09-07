# Kitrack 使用色の追加元選択 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** キット詳細の「使用色」に、既存塗料・保存済み混色・新規混色の3経路から独立したキット使用色を追加できるUIを実装する。

**Architecture:** `KitColorComposerModal` を3経路のオーケストレーターにし、既存の塗料ピッカー、混色カード、混色エディターを再利用する。保存済み混色は `addKitColorFromSummary` で値をコピーし、元レシピへの参照や同期状態は保持しない。

**Tech Stack:** Expo `~54.0.36`、React Native `0.81.5`、TypeScript `~5.9.2`、expo-sqlite、node:test。

**Spec:** `docs/superpowers/specs/2026-08-30-kit-used-colors-source-selection-design.md`

## Global Constraints

- キット使用色と保存済み混色は完全独立とし、リンクIDや同期操作を追加しない。
- 新規混色はキット使用色だけに保存し、「保存済み混色にも追加」チェックボックスを追加しない。
- DBスキーマとクラウドバックアップschemaを変更しない。
- 新しいnpm依存を追加せず、既存コンポーネントを再利用する。
- 保存済み混色のratioを整数%へ丸めず、そのままコピーする。
- 既存の未コミット変更を保持し、この機能に必要な箇所だけ編集する。
- 完了時に `npm run test`、`npm run typecheck`、`git diff --check` を実行する。

---

## File Map

- `lib/db/kitColors.ts`: 保存済み混色を独立したキット使用色へコピーするDB境界。
- `lib/db.ts`: 新しいDB関数の公開。
- `lib/kitColors.test.cjs`: ratio・順序・メタデータを保持したコピーの回帰テスト。
- `components/ColorMixPaintPickerModal.tsx`: 塗料種別を固定しない選択モードを許可。
- `components/ColorMixCard.tsx`: 選択先を明示する任意のアクセシビリティラベルを許可。
- `components/ColorMixEditorModal.tsx`: 保存ボタン文言を呼び出し元から指定可能にする。
- `components/KitColorComposerModal.tsx`: 3経路の選択、保存済み一覧、ロード／空／エラー／保存状態を管理。
- `components/KitDetailModal.tsx`: 「使用色」タブ、CTA、アクセシビリティ状態を接続。
- `components/KitDetail/styles.ts`: 追加CTAの48ptタップ領域を保証。
- `translations/ja.json`, `translations/en.json`: 新しい画面文言。

---

### Task 1: 保存済み混色を独立コピーするDB境界

**Files:**
- Modify: `lib/kitColors.test.cjs`
- Modify: `lib/db/kitColors.ts`
- Modify: `lib/db.ts`

**Interfaces:**
- Consumes: `ColorMixSummary`、既存 `addKitColor(kitId, name, note, paints)`。
- Produces: `addKitColorFromSummary(kitId: number, summary: ColorMixSummary): Promise<void>`。

- [ ] **Step 1: 失敗するコピー回帰テストを書く**

`lib/kitColors.test.cjs` の末尾へ次を追加する。

```js
test('copying a saved mix to a kit preserves metadata, ratio and paint order', async () => {
  const statements = [];
  const db = {
    async withTransactionAsync(fn) { await fn(); },
    async getFirstAsync() { return { n: 2 }; },
    async runAsync(sql, args) {
      statements.push([sql, args]);
      return { lastInsertRowId: 21 };
    },
  };
  const api = loadKitColors(db);

  await api.addKitColorFromSummary(7, {
    id: 9,
    name: 'Ocean',
    note: 'underside',
    paints: [
      { paint_id: 4, ratio: 0.3333, sort_order: 0 },
      { paint_id: 8, ratio: 0.6667, sort_order: 1 },
    ],
  });

  assert.deepEqual(statements, [
    ['INSERT INTO kit_colors (kit_id, name, note, sort_order) VALUES (?, ?, ?, ?)', [7, 'Ocean', 'underside', 2]],
    ['INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [21, 4, 0.3333, 0]],
    ['INSERT INTO kit_color_paints (kit_color_id, paint_id, ratio, sort_order) VALUES (?, ?, ?, ?)', [21, 8, 0.6667, 1]],
  ]);
});
```

テスト用オブジェクトは実行時に `paint_id` と `ratio` だけを読むため、TypeScriptの表示用フィールドは不要。

- [ ] **Step 2: テストが未実装関数で失敗することを確認する**

Run: `node --test lib/kitColors.test.cjs`

Expected: FAIL with `api.addKitColorFromSummary is not a function`。

- [ ] **Step 3: 最小のコピー関数を実装する**

`lib/db/kitColors.ts` に追加する。

```ts
export async function addKitColorFromSummary(
  kitId: number,
  summary: ColorMixSummary,
): Promise<void> {
  await addKitColor(
    kitId,
    summary.name,
    summary.note,
    summary.paints.map((paint) => ({ paintId: paint.paint_id, ratio: paint.ratio })),
  );
}
```

`lib/db.ts` のkit color exportへ `addKitColorFromSummary` を追加する。コピー元IDは保存しない。

- [ ] **Step 4: 狭いテストを通す**

Run: `node --test lib/kitColors.test.cjs`

Expected: 全テストPASS。

- [ ] **Step 5: コミットする**

```bash
git add lib/db/kitColors.ts lib/db.ts lib/kitColors.test.cjs
git commit -m "feat: copy saved mixes into kit colors"
```

---

### Task 2: 既存UI部品を3経路から再利用可能にする

**Files:**
- Modify: `components/ColorMixPaintPickerModal.tsx`
- Modify: `components/ColorMixCard.tsx`
- Modify: `components/ColorMixEditorModal.tsx`

**Interfaces:**
- Consumes: 既存 `HierarchyBrowser`、`ColorMatcher`、`ColorMixEditor`。
- Produces:
  - `ColorMixPaintPickerModal.paintType?: string`
  - `ColorMixPaintPickerModal.title?: string`
  - `ColorMixCard.accessibilityLabel?: string`
  - `ColorMixEditorModal.saveLabel?: string`

- [ ] **Step 1: 呼び出し側が必要とするPropsを定義する**

`ColorMixPaintPickerModal.tsx` のPropsを次の形にする。

```ts
interface Props {
  visible: boolean;
  paintType?: string;
  title?: string;
  onSelect: (paint: PickerPaint) => Promise<boolean>;
  onClose: () => void;
}
```

一覧には値がある場合だけフィルターを渡す。

```tsx
<HierarchyBrowser
  key={paintType ?? 'all'}
  paintType={paintType}
  selectionOnly
  onSelect={select}
  onSelectView={select}
  onRequestClose={onClose}
/>
```

`ColorMatcher` も `lockedPaintType={paintType}` とし、タイトルは `{title ?? t('addPaint')}` にする。

- [ ] **Step 2: カードの操作目的を読み上げられるようにする**

`ColorMixCard.tsx` のPropsへ任意ラベルを追加する。

```ts
interface Props {
  color: ColorMixSummary;
  onPress: () => void;
  ownedMap?: Map<number, number>;
  dragHandle?: ReactNode;
  accessibilityLabel?: string;
}
```

既存ラベルをフォールバックにする。

```tsx
accessibilityLabel={accessibilityLabel ?? `${name}, ${color.paints.length} ${t('usedPaints')}, ${resultLabel}`}
```

- [ ] **Step 3: 混色エディターの保存文言を指定可能にする**

`ColorMixEditorModal.tsx` に任意の `saveLabel` を追加し、既存の呼び出しを壊さず渡す。

```ts
interface Props {
  visible: boolean;
  title: string;
  initialDraft: MixDraft;
  saveLabel?: string;
  onSave: (draft: MixDraft) => Promise<void>;
  onClose: () => void;
}
```

```tsx
{visible ? (
  <ColorMixEditor
    initialDraft={initialDraft}
    saveLabel={saveLabel}
    onSave={save}
    onDirtyChange={setDirty}
  />
) : null}
```

- [ ] **Step 4: 型チェックで既存呼び出しとの互換性を確認する**

Run: `npm run typecheck`

Expected: PASS。既存の混色シミュレーターはProps追加なしでコンパイルできる。

- [ ] **Step 5: コミットする**

```bash
git add components/ColorMixPaintPickerModal.tsx components/ColorMixCard.tsx components/ColorMixEditorModal.tsx
git commit -m "refactor: reuse mix pickers for kit colors"
```

---

### Task 3: 3経路の使用色追加モーダルを実装する

**Files:**
- Modify: `components/KitColorComposerModal.tsx`
- Modify: `translations/ja.json`
- Modify: `translations/en.json`

**Interfaces:**
- Consumes:
  - `addKitColor(kitId, name, note, paints)`
  - `addKitColorFromSummary(kitId, summary)`
  - `getMixRecipes(): Promise<ColorMixSummary[]>`
  - `ColorMixPaintPickerModal`
  - `ColorMixEditorModal`
  - `ColorMixCard`
- Produces: 既存Props `visible`, `kitId`, `onClose`, `onAdded` を維持した3経路モーダル。

- [ ] **Step 1: 翻訳キーを追加する**

`translations/ja.json` と `translations/en.json` に次の対応を追加する。

```text
usedColorsTab       使用色                         / Used Colors
kitUsedColors       このキットで使う色             / Colors used for this kit
addUsedColor        使用色を追加                   / Add Used Color
chooseColorSource   追加方法を選択                 / Choose How to Add
choosePaint         塗料から選ぶ                   / Choose a Paint
choosePaintHelp     塗料一覧から1色を追加           / Add one color from the paint catalog
chooseSavedMix      保存済み混色から選ぶ           / Choose a Saved Mix
chooseSavedMixHelp  シミュレーターで保存した配合をコピー / Copy a mix saved in the simulator
createKitMix        新しく混色を作る               / Create a New Mix
createKitMixHelp    このキット専用の配合を作成       / Create a mix for this kit
pickPaintForKit     キットに追加する塗料を選択       / Choose a Paint for This Kit
pickMixForKit       キットに追加する混色を選択       / Choose a Mix for This Kit
addMixToKit         キットに追加                   / Add to Kit
saveToKit           キットに登録                   / Save to Kit
savedMixPickerEmpty 保存済み混色はありません。混色シミュレーターで保存すると、ここから選べます。 / No saved mixes yet. Save one in the mixing simulator to choose it here.
emptyKitColors      使用色はまだありません。使用色を追加から登録できます。 / No colors added yet. Use Add Used Color to add one.
loadFailed          読み込みに失敗しました         / Loading failed.
```

- [ ] **Step 2: モーダルの状態機械を実装する**

`KitColorComposerModal.tsx` は次の状態だけを持つ。

```ts
type Route = 'source' | 'paint' | 'saved' | 'newMix';

const [route, setRoute] = useState<Route>('source');
const [recipes, setRecipes] = useState<ColorMixSummary[]>([]);
const [loading, setLoading] = useState(false);
const [loadError, setLoadError] = useState(false);
const [savingId, setSavingId] = useState<number | null>(null);
```

`visible` がfalseになったら `route='source'`、エラー、保存状態を初期化する。`saved` へ移動した時だけ `getMixRecipes()` を呼び、失敗時は一覧を保持して再試行ボタンを表示する。

- [ ] **Step 3: 追加元選択画面を実装する**

既存テーマトークンだけを使い、3つの縦並びボタンを描画する。各ボタンはタイトルと説明を一つのアクセシビリティ要素にする。

```tsx
const sourceButton = (titleKey: string, helpKey: string, next: Route, icon: ReactNode) => (
  <TouchableOpacity
    accessibilityRole="button"
    accessibilityLabel={`${t(titleKey)}。${t(helpKey)}`}
    onPress={() => setRoute(next)}
    style={styles.sourceButton}
  >
    <View style={styles.sourceIcon}>{icon}</View>
    <View style={styles.sourceText}>
      <Text style={styles.sourceTitle}>{t(titleKey)}</Text>
      <Text style={styles.sourceHelp}>{t(helpKey)}</Text>
    </View>
    <IconChevronRight color={colors.textMuted} size={20} />
  </TouchableOpacity>
);
```

ヘッダーは `chooseColorSource`、閉じる操作は `onClose`。主要タップ領域は `touch.min` 以上にする。

- [ ] **Step 4: 単色追加を実装する**

塗料選択後は表示名だけ問い合わせ、ratio 1で保存する。

```ts
const addPaint = async ({ id }: { id: number }): Promise<boolean> => {
  if (savingId != null) return false;
  setSavingId(id);
  try {
    const paint = await getDB().getFirstAsync<{
      id: number;
      name_ja: string;
      name_en: string | null;
    }>('SELECT id, name_ja, name_en FROM catalog_paints WHERE id = ?', [id]);
    if (!paint) throw new Error('paint_not_found');
    await addKitColor(kitId, paintName(paint.name_ja, paint.name_en), null, [
      { paintId: paint.id, ratio: 1 },
    ]);
    await onAdded();
    onClose();
    return true;
  } catch (error) {
    console.error('KitColorComposerModal: failed to add paint', error);
    Alert.alert(t('error'), t('saveFailed'));
    return false;
  } finally {
    setSavingId(null);
  }
};
```

`ColorMixPaintPickerModal` は `paintType` を渡さず、`title={t('pickPaintForKit')}` で開く。

- [ ] **Step 5: 保存済み混色一覧とコピーを実装する**

`FlatList` を使い、ロード中、エラー＋再試行、空状態、一覧を排他的に表示する。カード選択時は次を実行する。

```ts
const addSavedMix = async (recipe: ColorMixSummary) => {
  if (savingId != null) return;
  setSavingId(recipe.id);
  try {
    await addKitColorFromSummary(kitId, recipe);
    await onAdded();
    onClose();
  } catch (error) {
    console.error('KitColorComposerModal: failed to copy saved mix', error);
    Alert.alert(t('error'), t('saveFailed'));
  } finally {
    setSavingId(null);
  }
};
```

カードには `accessibilityLabel={`${displayName}。${t('addMixToKit')}`}` を渡し、保存中は全カードを無効化または操作関数で遮断する。表示用の整数%をDBへ戻さない。

- [ ] **Step 6: 新規混色保存を実装する**

空ドラフトを毎回生成し、キット使用色だけへ保存する。

```tsx
<ColorMixEditorModal
  visible={visible && route === 'newMix'}
  title={t('createKitMix')}
  saveLabel={t('saveToKit')}
  initialDraft={initialDraft}
  onSave={async (draft) => {
    await addKitColor(
      kitId,
      draft.name.trim() || null,
      draft.note.trim() || null,
      normalizeDraftPaints(draft.paints),
    );
    await onAdded();
    onClose();
  }}
  onClose={() => setRoute('source')}
/>
```

閉じる操作は、子画面では `source` に戻り、追加完了時だけ親の `onClose()` を呼ぶ。

- [ ] **Step 7: 型チェックと既存DBテストを実行する**

Run: `node --test lib/kitColors.test.cjs`

Expected: PASS。

Run: `npm run typecheck`

Expected: PASS。

- [ ] **Step 8: コミットする**

```bash
git add components/KitColorComposerModal.tsx translations/ja.json translations/en.json
git commit -m "feat: add kit color source chooser"
```

---

### Task 4: キット詳細へ接続し回帰確認する

**Files:**
- Modify: `components/KitDetailModal.tsx`
- Modify: `components/KitDetail/styles.ts`
- Verify: `components/KitColorRow.tsx`
- Verify: `components/ColorMixDetailModal.tsx`

**Interfaces:**
- Consumes: Task 3の既存Props互換 `KitColorComposerModal`。
- Produces: 「使用色」タブと「＋ 使用色を追加」CTA。

- [ ] **Step 1: タブとセクションの文言・状態を更新する**

`KitDetailModal.tsx` の色タブを次のようにする。

```tsx
<TouchableOpacity
  accessibilityRole="tab"
  accessibilityState={{ selected: detailTab === 'colors' }}
  accessibilityLabel={t('usedColorsTab')}
  style={[styles.tabBtn, detailTab === 'colors' && styles.tabBtnActive]}
  onPress={() => setDetailTab('colors')}
>
  <Text style={[styles.tabText, detailTab === 'colors' && styles.tabTextActive]}>
    {t('usedColorsTab')}
  </Text>
</TouchableOpacity>
```

詳細情報タブにも `accessibilityRole="tab"` と選択状態を追加する。色セクション見出しは `kitUsedColors` にする。

- [ ] **Step 2: 明確な追加CTAへ更新する**

```tsx
<TouchableOpacity
  accessibilityRole="button"
  accessibilityLabel={t('addUsedColor')}
  onPress={() => setPickerOpen(true)}
  style={styles.addColorButton}
>
  <IconPlus color={colors.primary} size={18} />
  <Text style={styles.addLink}>{t('addUsedColor')}</Text>
</TouchableOpacity>
```

`IconPlus` を既存アイコンimportへ追加する。`styles.addColorButton` は `minHeight: 48`、`flexDirection: 'row'`、`alignItems: 'center'`、`gap: spacing.xs` を持たせる。

- [ ] **Step 3: 空状態を追加する**

使用色が0件の場合だけ、CTAの下に説明付き空状態を表示する。

```tsx
{kitColors.length === 0 ? (
  <Text style={styles.empty}>{t('emptyKitColors')}</Text>
) : null}
```

- [ ] **Step 4: 全自動検証を実行する**

Run: `npm run test`

Expected: 全テストPASS。

Run: `npm run typecheck`

Expected: PASS。

Run: `git diff --check`

Expected: 出力なし、exit 0。

- [ ] **Step 5: Expoバンドルを確認する**

既存のExpo Goサーバーが稼働している場合、`http://127.0.0.1:8082/index.bundle?platform=ios&dev=true&minify=false` がHTTP 200を返すことを確認する。停止中ならユーザー承認済みの非本番Expo Goサーバーをこの専用worktreeから起動する。

- [ ] **Step 6: 実機確認を行う**

Expo Goで次を確認する。

1. キット詳細のタブが「使用色」、CTAが「使用色を追加」と表示される。
2. 3経路の説明が一目で区別できる。
3. 塗料から選ぶと100%の単色が追加される。
4. 保存済み混色を追加後、元を編集・削除してもキット側が変わらない。
5. 新規混色は合計100%だけ保存でき、保存済み一覧には増えない。
6. 子画面の閉じる／戻るで追加元選択へ戻れる。
7. 長い名称、空一覧、読込失敗、連続タップでレイアウト崩れや重複登録がない。

- [ ] **Step 7: コミットする**

```bash
git add components/KitDetailModal.tsx components/KitDetail/styles.ts translations/ja.json translations/en.json
git commit -m "feat: connect kit used color flows"
```

---

## Final Review

- [ ] 仕様書の全項目がTask 1〜4のいずれかで実装されていることを確認する。
- [ ] キット使用色と保存済み混色を関連付けるカラム・状態・文言が増えていないことを確認する。
- [ ] `git status --short` で、今回のコミット対象と既存の未コミット変更を区別する。
- [ ] `npm run test`、`npm run typecheck`、`git diff --check` の最終結果を記録する。
