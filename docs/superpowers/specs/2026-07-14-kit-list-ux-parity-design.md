# キット一覧画面のUI/UXを保管箱画面に揃える + 価格フィールド追加 設計

## 背景・目的

`app/(tabs)/kits.tsx`(キット一覧)は`app/(tabs)/owned.tsx`(保管箱/塗料一覧)と同じ「ボックス横断/個別ボックス表示」という構造を持つが、画面上部・下部のUIが簡素なまま(チップ行のみ・裸のFABのみ)で、絞り込み・並び替え機能が存在しない。ユーザー要望:

- 画面タイトル「すべてのキットボックス」を「すべてのボックス」に統一する(ドロワーの表記統一と揃える)
- 画面上部の表示(件数サマリー・ステータス選択)と下部のメニュー(絞り込み・並び替え)を、保管箱画面と同じデザイン・機能で実装する
- キットの情報に「価格」を追加する

## スコープ

### 今回やること

- `kits.tsx`に`owned.tsx`と同型のステータスバー(件数サマリー+ステータス選択ボタン)・`AdBanner`・`ListActionBar`(絞り込み/並び替え/追加)を追加
- 新規`KitFilterModal`(`FilterModal`のキット版、対象: メーカー/シリーズ/種別/スケール)を追加
- 並び替え(追加順/名前順/メーカー順)を`ActionSheet`で追加
- 画面タイトルの「すべてのキットボックス」を「すべてのボックス」に統一し、`router.setParams({ boxName: title })`も追加(owned.tsxと同じ挙動に揃える)
- `kits`テーブルに`price`(価格・整数・任意)列を追加し、キット追加画面(`AddKitModal`)とキット詳細/編集画面(`KitDetailModal`)に価格フィールドを追加

### 今回もやらないこと

- 一覧行(リストアイテム)への価格表示。塗料側もseries/category/note等の詳細項目は一覧行に出しておらず、価格も詳細画面のみの表示に揃える
- 通貨記号・多通貨対応。価格は単純な数値(整数)として保存・表示する(千区切りのみ)。将来的に必要なら別途対応する
- スワイプ操作(スワイプで削除・ステータス変更)。今回のスコープは上部表示と下部メニューのみで、`PaintRow`の`Swipeable`ジェスチャーはキット一覧には持ち込まない
- 絞り込み条件でのブランド→シリーズのようなカスケード選択。メーカー/シリーズ/種別/スケールの4項目は独立した複数選択とする

## 画面上部: ステータスバー

`owned.tsx`の`statusBarWrap`をそのまま移植する。

```tsx
<View style={styles.statusBarWrap}>
  <Text style={styles.statusCount}>{locale === 'ja'
    ? `キット数 ${kitTotal} ・ 表示数 ${items.length}`
    : `Kits ${kitTotal} · Showing ${items.length}`}</Text>
  {!completedScreen ? <TouchableOpacity style={styles.statusSelect} onPress={() => setShowStatusPicker(true)}>
    <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
    <Text style={styles.statusSelectText}>{statusLabel}</Text><IconChevronDown color={colors.textMuted} size={18} />
  </TouchableOpacity> : null}
</View>
<View style={styles.adBar}><AdBanner /></View>
```

- `kitTotal`: `completedScreen`時は`items.length`、それ以外は選択中ボックスの件数(`owned.tsx`の`inventoryTotal`と同じロールで、`load()`内で`SELECT COUNT(*) FROM kits WHERE status IN ('not_started','building')`+ボックス条件を集計)
- `statusDefault`: `statuses.length === 2 && statuses.includes('not_started') && statuses.includes('building')`
- `statusLabel`: `statusDefault`なら「すべてのステータス」/"All statuses"(ハードコード、owned.tsxと同じ)、単一選択なら`t('statusNotStarted' | 'statusBuilding')`、それ以外は`t('statusAll')`
- `statusColor`: `statusDefault`なら`#2e7d32`(緑、owned.tsxと同じ)、`not_started`→`colors.primary`、`building`→`colors.inUse`
- ステータス選択モーダルは`owned.tsx`の中央`Modal`(バックドロップ+チェックリスト+OK)をそのまま移植し、対象は`STATUS_TOGGLES`相当の`[{key:'not_started', label:'statusNotStarted'}, {key:'building', label:'statusBuilding'}]`(現行の`STATUS_CHIPS`をこの用途に転用、チップ行のUIは廃止)

## 画面下部: ListActionBar

現行の裸のFABを`ListActionBar`に置き換える。

```tsx
<ListActionBar onFilter={() => setShowFilter(true)} onSort={openSort} onAdd={() => setShowAdd(true)} filterActive={filterActive} />
```

### 並び替え

```ts
type KitSort = 'added' | 'name' | 'maker';
const KIT_SORT_ORDER: Record<KitSort, string> = {
  added: 'added_at DESC',
  name: 'name COLLATE NOCASE ASC',
  maker: 'maker ASC, name ASC',
};
```

`openSort()`は`owned.tsx`と同型で`ActionSheet`に`sortAdded`/`sortName`/`sortMaker`(新規キー)の3択+キャンセルを出す。

### 絞り込み: `KitFilterModal`(新規コンポーネント)

`components/FilterModal.tsx`をベースに、対象フィールドをメーカー/シリーズ/種別/スケールに置き換える。カスケードは行わず4項目とも独立の複数選択。

```ts
export interface KitFilter {
  makers: string[];
  series: string[];
  categories: string[];
  scales: string[];
  search: string;
}
interface Props {
  visible: boolean;
  options: { maker: string; series: string | null; category: string | null; scale: string | null }[];
  initial: KitFilter;
  onApply: (f: KitFilter) => void;
  onClose: () => void;
}
```

- 検索欄のプレースホルダーは`t('searchPlaceholder')`を流用しつつ、検索対象はキット名(`name`)のみ(`WHERE name LIKE ?`)
- `options`は`load()`内で`SELECT DISTINCT maker, series, category, scale FROM kits`を集計して渡す
- UI構造(ヘッダー/検索欄/ドロップダウン式チェックリスト/適用ボタン)は`FilterModal`と同一。`brandLabel`/`seriesLabel`/`glossLabel`/`paintTypeLabel`のようなラベル変換は不要で、値をそのまま表示する

## タイトル文言の統一

`kits.tsx`の`selected === 'all'`時のタイトルを次のように変更する(owned.tsxと文言・挙動を完全一致させる)。

```tsx
if (selected === 'all') {
  const title = locale === 'ja' ? 'すべてのボックス' : 'All Boxes';
  navigation.setOptions({ title });
  router.setParams({ boxName: title });
  return;
}
```

## 価格フィールドの追加

### スキーマ変更

`kits`テーブルに`price INTEGER`(任意、円単位の整数)を追加する。

```sql
CREATE TABLE IF NOT EXISTS kits (
  ...,
  scale TEXT, note TEXT, price INTEGER,
  ...
);
```

既存端末向けに`initDB()`へマイグレーションを追加(確立済みパターンに準拠)。

```ts
try { await db.execAsync('ALTER TABLE kits ADD COLUMN price INTEGER'); } catch { /* 既にある */ }
```

### `KitDetail`型・`getKitDetail`・`updateKitPrice`

```ts
export interface KitDetail {
  ...
  price: number | null;
  ...
}
```

`getKitDetail`のSELECT列に`k.price`を追加。

```ts
export async function updateKitPrice(kitId: number, price: string): Promise<void> {
  const trimmed = price.trim();
  const parsed = trimmed === '' ? null : Number(trimmed);
  const normalized = parsed !== null && Number.isFinite(parsed) ? parsed : null;
  await getDB().runAsync(
    "UPDATE kits SET price = ?, status_changed_at = datetime('now') WHERE id = ?",
    [normalized, kitId]
  );
}
```

(`updateKitScale`等の既存関数と同じ「文字列を受け取り正規化してUPDATEする」形に揃える)

### `AddKitModal.tsx`

`scale`欄の下に価格欄を追加する。

```tsx
<View style={styles.field}>
  <Text style={styles.label}>{t('price')}</Text>
  <ClearableInput style={styles.input} value={price} onChangeText={setPrice} keyboardType="numeric" placeholder="0" />
</View>
```

`save()`のINSERT文に`price`列を追加し、`price.trim() === '' ? null : Number(price.trim())`を渡す。

### `KitDetailModal.tsx`

`series`/`category`と同じ`card`ブロック内、`category`の下に価格フィールドを追加する。編集モードは`ClearableInput`(`keyboardType="numeric"`)、閲覧モードは`price != null ? price.toLocaleString() : t('unknown')`を表示する。`savePrice`ハンドラと`flushPendingFields`への組み込みも、`saveScale`/`saveSeries`と同じパターンで追加する。

## 新規翻訳キー

- `price`: 「価格」/ "Price"
- `sortMaker`: 「メーカー順」/ "By Maker"

他のキー(`maker`/`series`/`category`/`scale`/`sortAdded`/`sortName`/`filter`/`sort`/`apply`/`clear`等)は既存キーを流用する。

## 検証方法

- `npx tsc --noEmit`
- UTF-8 BOMなし確認
- 実機での確認: キット一覧画面上部に件数サマリー・ステータス選択・広告バナーが表示されること。ステータス選択で未着手/制作中の絞り込みが機能すること。下部の絞り込み/並び替え/追加ボタンが機能すること。絞り込みでメーカー/シリーズ/種別/スケールを選択して一覧が絞られること。並び替えで追加順/名前順/メーカー順が切り替わること。「すべてのボックス」表記になっていること。キット追加・編集画面で価格を入力・保存・表示できること。
