# ナビゲーションドロワー: Colorack/Kitrackモード切り替え 設計

## 背景・目的

現在の`components/NavigationDrawer.tsx`は、塗料ボックス関連の項目とキットボックス関連の項目を1つの連続したリストに常に両方表示している。ユーザーからの要望:

- ドロワー最上部に「Colorack」(塗料管理)と「Kitrack」(キット管理)を切り替える導線を置き、ドロワーの表示内容をモードごとに出し分けたい
- 内部の呼称(カラーボックス/キットボックス)はそのままに、UI表記は両モードとも単に「ボックス」で統一する
- Kitrackモードの構成・挙動は、既存のColorackモード(塗料ボックス)のUI/UXにできる限り合わせる。具体的には: 「完成品」を「使用済み」と同じ扱いにする(ボックス内には出てこない専用一覧)、デフォルトボックスの概念、ボックス0件時の初期ボックス自動作成、ボックス最後の1個は削除不可、という塗料ボックス側の既存仕様をキットボックス側にも揃える

## スコープ

### 今回やること

- ドロワーにColorack/Kitrackのモード切り替えを追加し、選択したモードはアプリを閉じても記憶する
- Kitrackモードのドロワー構成をColorackに合わせて再設計(ボックス一覧+完成品+塗料一覧+設定)
- `/completed`(完成品専用画面)を`/used`と同じパターンで新規追加
- キット完成時にボックスから外れる仕組み(`setKitStatus`のbox_id制御)を塗料の`setInventoryStatus`に合わせて実装
- デフォルトキットボックスの概念(`getDefaultKitBoxId`)と、キットボックス0件時の自動作成をkit_boxesにも追加
- キットボックス削除の下限を1個に統一(`KitBoxOptions.tsx`に`BoxOptions.tsx`と同じガードを追加)

### 今回もやらないこと

- ドロワー外の画面(`/kits`本体の見た目、`KitDetailModal`等)のブランディング変更。今回はドロワーの表示内容切り替えに閉じる
- お気に入り・買い物リストのキット版(そもそも該当する概念が無いため対象外)

## ドロワーのモード切り替え

### `lib/appMode.ts`(新規)

既存の`lib/activeBox.ts`と同じ購読パターン(モジュール変数+リスナーセット)に、`app_settings`経由の永続化を追加する。

```ts
export type AppMode = 'colorack' | 'kitrack';

let appMode: AppMode = 'colorack';
const listeners = new Set<() => void>();

export async function initAppMode(): Promise<void> {
  const saved = await getSetting('appMode');
  if (saved === 'kitrack') appMode = 'kitrack';
}

export function setAppMode(next: AppMode): void {
  if (appMode === next) return;
  appMode = next;
  listeners.forEach((listener) => listener());
  setSetting('appMode', next);
}

export function useAppMode(): AppMode {
  const [, force] = useReducer((value) => value + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return appMode;
}
```

`initAppMode()`は`app/_layout.tsx`の既存の起動シーケンス(`initDB()`/`initTheme()`/`initLocale()`と同じ並び)に追加し、画面表示前にモードを復元する。

### `NavigationDrawer.tsx`の再構成

最上部のタイトル行を横並びにし、右端に相手モードへの切り替えリンクを置く(タップで`setAppMode()`)。

```
Colorack ..................... [Kitrack]
```
```
Kitrack ....................... [Colorack]
```

モードごとに表示ブロックを丸ごと出し分ける:

**Colorackモード**: すべてのボックス/個別ボックス/ボックス追加 → 使用済み/お気に入り/買い物リスト → 塗料一覧 → 設定

**Kitrackモード**: すべてのボックス/個別ボックス/ボックス追加(キットボックスのデータだが表記は「ボックス」で統一) → 完成品 → 塗料一覧 → 設定

「塗料一覧」「設定」は両モード共通で、モード分岐の外(リスト末尾)に常時表示する。

## 「完成品」画面と、完成キットのボックス除外

### 参考にする既存パターン: `/used`

`app/(tabs)/used.tsx`は`owned.tsx`がエクスポートする`InventoryScreen`を`usedScreen`フラグ付きで再利用する薄いラッパー。保管箱(`/owned`)側は`STATUS_TOGGLES`が`owned`/`in_use`のみで`used_up`を含まず、使用済みは常に`/used`の専用画面でしか見えない。

### 同じ形で`/completed`を追加

- `app/(tabs)/kits.tsx`のコンポーネントを`KitsScreen({ completedScreen }: { completedScreen?: boolean })`という受け取り可能な形にリファクタリングしてエクスポートする
- 新規`app/(tabs)/completed.tsx`は`<KitsScreen completedScreen />`を描画するだけ
- `completedScreen`時: 常に`status = 'completed'`のみを表示し、ボックス横断・ステータス切り替えチップは非表示
- 通常モード(`completedScreen`なし)時: ステータス切り替えチップの候補から`completed`を外し(`not_started`/`building`のみ)、デフォルトの表示状態も両方ONにする(現状の3つ→2つに変更)

### `setKitStatus`のbox_id制御

`setInventoryStatus`と同じCASE文パターンに変更する。

```ts
export async function setKitStatus(kitId: number, status: KitStatus): Promise<void> {
  const defaultBoxId = status === 'completed' ? null : await getDefaultKitBoxId();
  await getDB().runAsync(
    "UPDATE kits SET status = ?, box_id = CASE WHEN ? = 'completed' THEN NULL WHEN box_id IS NULL THEN ? ELSE box_id END, status_changed_at = datetime('now') WHERE id = ?",
    [status, status, defaultBoxId, kitId]
  );
}
```

`initDB()`には、この仕様導入前に完成済みになっていたキット(実機テストで作られた可能性がある)のbox_idを一度だけクリアする移行処理も追加する。

```ts
await db.runAsync("UPDATE kits SET box_id = NULL WHERE status = 'completed'");
```

## デフォルトキットボックス

### `getDefaultKitBoxId()`(新規)

`getDefaultBoxId()`と全く同じ実装。`app_settings`の`default_kit_box_id`を読み、実在確認して返す。削除済みなら`null`(再設定処理は行わない、`getDefaultBoxId()`と同じ割り切り)。

```ts
export async function getDefaultKitBoxId(): Promise<number | null> {
  const v = await getSetting('default_kit_box_id');
  if (!v) return null;
  const id = Number(v);
  const exists = await getDB().getFirstAsync('SELECT id FROM kit_boxes WHERE id = ?', [id]);
  return exists ? id : null;
}
```

### `initDB()`: キットボックス0件時の自動作成

塗料ボックスの初期化処理と全く同じ形で、`kit_boxes`が0件の時だけ「Box」という名前のキットボックスを作成しデフォルトに設定する。

```ts
const kitBoxCount = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM kit_boxes');
if ((kitBoxCount?.n ?? 0) === 0) {
  const res = await db.runAsync('INSERT INTO kit_boxes (name) VALUES (?)', ['Box']);
  await db.runAsync(
    'INSERT INTO app_settings (key, value) VALUES (?, ?)'
    + ' ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ['default_kit_box_id', String(res.lastInsertRowId)]
  );
}
```

### `kits.tsx`: 「すべてのキットボックス」表示中の追加先

`owned.tsx`が`AddPaintModal`の`boxId`に`selected === 'all'`のとき`getDefaultBoxId()`の結果を使っているのと同じ扱いに変更する(現状は`null`固定になっている)。

## キットボックス削除の下限

`components/BoxOptions.tsx`の削除ボタンは`boxes.length > 1`のときだけメニューに含まれる(最後の1個は削除不可)。`components/KitBoxOptions.tsx`にも同じガードを追加する。

```ts
...(boxes.length > 1 ? [{ text: t('delete'), style: 'destructive' as const, onPress: confirmDelete }] : []),
```

## 検証方法

- `npx tsc --noEmit`
- UTF-8 BOMなし確認
- 実機での確認: ドロワーでKitrackに切り替え→タイトルが「Kitrack」になり右端に「Colorack」リンクが出ることを確認。アプリを再起動してもKitrackモードが記憶されていることを確認。Kitrackドロワーに完成品/塗料一覧/設定が出て、キットボックス個別項目は「ボックス」表記になっていることを確認。キットを完成にする→そのキットがボックス内一覧から消え、「完成品」画面には出ることを確認。未完成に戻す→デフォルトボックスに入ることを確認。キットボックスを1個まで減らす→削除ボタンがメニューから消えることを確認。全キットボックスを削除できる状態(0件)にはならないため、その状態での自動作成は再起動時の安全策として存在する旨を確認。
