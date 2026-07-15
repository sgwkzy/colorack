# キットボックス機能 設計

## 背景・目的

これまでColorackは塗料の在庫管理(カラーボックス/保管箱・塗料カタログ)に特化していた。次の開発対象として、プラモデル本体(キット)を管理する「キットボックス」機能と、各キットに使用する塗料をまとめる「キット詳細ページ」を追加する。既存の塗料保管箱の仕組みを踏襲しつつ、キットと塗料カタログを紐付けることで、製作時の色計画・記録ができるようにする。

## スコープ

### v1で作るもの

- キットボックス(保管箱の別枠、キット専用)の作成・一覧・切り替え
- キットの手動登録(名前・メーカー・スケール・メモ・写真・状態・所属ボックス)
- キットの状態管理(未着手/制作中/完成の3段階)
- キット詳細ページでの、塗料カタログからの色の紐付け(色ごとにメモ可)・削除
- ナビゲーションドロワーへのキットボックスセクション追加

### v1でやらないこと(将来検討)

- キットのカタログDB化(メーカー・シリーズが膨大なため、公式サイトクロールは非現実的)
- Amazon等の商品情報API連携によるキット情報の自動入力
- キットのバーコードスキャン
- キットのお気に入り/買い物リスト
- **キット詳細ページでの「使用する色」の見せ方の工夫**(スウォッチ表示・用途別グルーピングなど、ユーザーからのネクストアクション指定)
- **混色(複数塗料を組み合わせた任意の色)の登録機能**(同上、ネクストアクション指定)

## データモデル

既存の`boxes`/`inventory`テーブルと対になる構造。塗料と違い、キットには公式カタログが存在しないため「カタログ」と「所持記録」を分けず、`kits`テーブル1つで完結させる。

```sql
CREATE TABLE IF NOT EXISTS kit_boxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'box',
  icon_color TEXT NOT NULL DEFAULT '#4a90d9',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  box_id INTEGER,
  name TEXT NOT NULL,
  maker TEXT NOT NULL,
  scale TEXT,
  note TEXT,
  photo_uri TEXT,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started','building','completed')),
  added_at TEXT DEFAULT (datetime('now')),
  status_changed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kit_paints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kit_id INTEGER NOT NULL,
  paint_id INTEGER NOT NULL,  -- catalog_paints.id を参照。所持有無を問わずカタログ全体から選べる
  note TEXT,                  -- 「装甲」「コックピット」等の用途メモ
  added_at TEXT DEFAULT (datetime('now'))
);
```

`lib/db.ts`の`initDB()`に既存テーブルと同じパターン(`CREATE TABLE IF NOT EXISTS`)で追加する。マイグレーション不要(新規テーブルのみ)。

## 画面構成

既存のパターンを1対1で踏襲する。

| 既存(塗料) | 新規(キット) | 備考 |
|---|---|---|
| `app/(tabs)/owned.tsx` | 新規タブ(例: `app/(tabs)/kits.tsx`) | ヘッダーにボックス切り替え(`BoxTitlePicker`相当)、状態トグルは在庫/使用中/使用済→未着手/制作中/完成 |
| `components/InventoryDetailModal.tsx` | 新規`components/KitDetailModal.tsx` | 名前・メーカー・スケール・写真・メモ・状態を編集可能。「使用する色」セクションを新設 |
| 塗料追加モーダルの手動登録タブ | 新規`components/AddKitModal.tsx` | カタログ/検索/近似色タブは不要、手動フォームのみ |
| `components/BoxEditorModal.tsx` | そのまま流用可(name/icon/color構造が同じ) | `kit_boxes`用に呼び出し先テーブルだけ変える |
| `components/NavigationDrawer.tsx` | 同ファイルに新セクション追加 | 「すべてのキットボックス」+個別ボックス+追加ボタン。既存の塗料ボックスセクションとは別ブロックとして表示 |

### キット詳細ページの「使用する色」セクション

- 塗料カタログ全体から検索して追加(`components/AddPaint/TextSearch.tsx`の一覧選択パターンを再利用)
- 追加時に任意でメモを入力(用途メモ)
- 一覧はシンプルな行表示(色スワッチ+名前+メモ+削除ボタン)。将来的な見せ方の工夫(v1スコープ外)への置き換えを想定し、専用コンポーネント(例: `KitPaintRow.tsx`)として切り出す

## 技術メモ

- **写真**: `expo-image-picker`を新規依存として追加(カメラ/ギャラリー選択に両対応)。選択直後の一時URIは端末再起動やキャッシュクリアで消える可能性があるため、`expo-file-system`(新規依存)で`FileSystem.documentDirectory`配下にコピーしてから`kits.photo_uri`に永続パスを保存する
- 色の紐付けUIは新規に作らず、既存の`TextSearch.tsx`の検索結果一覧パターンをできるだけ再利用する(独自の検索ロジックを重複実装しない)
- 状態の3段階(`not_started`/`building`/`completed`)は既存`PaintStatus`型とは別の新しい型(例: `KitStatus`)として`lib/db.ts`に定義する
- `scale`はスケール表記の慣習がメーカー・ジャンルによって様々(1/144、1/100、NON-SCALEなど)なため、固定選択肢を設けず自由入力のテキストとする
- `photo_uri`は1キットにつき1枚のみ(複数枚対応はv1スコープ外)

## 検証方法

- `npx tsc --noEmit`
- 実機(Expo Go)で以下を確認:
  - キットボックスの作成・切り替え・キット追加ができる
  - キットの状態変更(未着手→制作中→完成)が保管箱同様に反映される
  - キット詳細ページで塗料カタログから色を検索して追加・メモ入力・削除ができる
  - 写真をカメラ/ギャラリーどちらからも設定でき、アプリ再起動後も表示され続ける(永続化の確認)
- 翻訳ファイル(ja/en)のキー整合性確認、UTF-8 BOMなし確認(既存の運用ルールに準拠)
