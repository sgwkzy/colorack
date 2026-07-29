# Kitrack版買い物リスト 設計書 (2026-07-17)

## 目的

Colorackの買い物リスト(`app/(tabs)/wishlist.tsx`)と同等の機能をKitrack(キット管理)側に提供する。「買いたいキット」を登録しておき、購入したらスワイプ操作でキット一覧(積みプラ)へ移せるようにする。

## データ設計

Colorackが買い物リストを専用テーブル(`lists` type='wishlist')で持つ仕様に合わせ、Kitrack側も専用テーブルを新設する。

```sql
CREATE TABLE IF NOT EXISTS kit_wishlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, maker TEXT NOT NULL, series TEXT, category TEXT, scale TEXT, note TEXT, price INTEGER,
  added_at TEXT DEFAULT (datetime('now'))
);
```

- 列は `kits` テーブルと同じ入力項目(box_id / status / status_changed_at を除く)。
- 写真は対象外(Colorack買い物リストにも写真は無い)。
- 作成場所: `lib/db.ts` の初期化スキーマに追加。既存DBにはマイグレーション不要(`CREATE TABLE IF NOT EXISTS` で自動作成)。

## 画面: `app/(tabs)/kit-wishlist.tsx`

`wishlist.tsx` と同じ構成の新規スクリーン。

- **ステータスバー**: 「キット数 N ・ 表示数 M」(en: `Kits N · Showing M`)。
- **広告バー**: `AdBanner`。
- **リスト行**: キット名・メーカー・シリーズ等を表示。既存のキット行表現(`kits.tsx` の行レイアウト)に合わせる。行タップの詳細モーダルは対象外(wishlist行は `kits` レコードではないため `KitDetailModal` は使えない。編集が必要なら削除→再登録で足りる)。
- **スワイプ操作**(Colorack買い物リストと同一パターン):
  - 左スワイプ「購入済み」: `kits` へ INSERT(status='not_started'、box_id=デフォルトのキットボックス)、`kit_wishlist` から DELETE。Undo付きトースト(Undoで kits から削除し wishlist へ戻す)。
  - 右スワイプ「削除」: `kit_wishlist` から DELETE。Undo付きトースト。
  - 他の行のSwipeableを閉じる制御(`onSwipeableWillOpen`)も既存画面と同様に入れる。
- **下部 ListActionBar**: フィルター・ソート・追加。
- **ソート**: 追加順(added_at DESC、既定)・名前・メーカー。ActionSheetで選択(wishlist.tsxと同形式)。
- **フィルター**: 既存 `KitFilterModal` を流用。選択肢は `kit_wishlist` 内のDISTINCT値から生成。
- **空状態**: `EmptyState`(アイコンは IconShoppingCartPlus)。未登録時は「キットを追加」アクション付き。
- **フォーカス時**: `setAppMode('kitrack')` を呼ぶ(ドロワーモード同期)。

## 追加フォーム: `AddKitModal` の小改修

既存 `components/AddKitModal.tsx` に保存先を切り替えるプロップを追加する。

- `saveTarget?: 'kits' | 'wishlist'`(既定 'kits'、既存呼び出しは無変更)。
- `'wishlist'` のとき: INSERT先を `kit_wishlist` にし、写真UI(追加ボタン・サムネイル)を非表示にする。box_id は使わない。
- バリデーション(名前・メーカー必須、価格は非負整数)は共通のまま。

## ナビゲーション

- **タブ登録**: `app/(tabs)/_layout.tsx` の `<Tabs>` に `kit-wishlist` スクリーンを追加(title: 買い物リスト / Wishlist)。
- **ドロワー**: `components/NavigationDrawer.tsx` のKitrackセクションで「完成済み」の下に「買い物リスト」項目を追加。件数バッジは `kit_wishlist` の COUNT。アクティブ判定は `pathname.endsWith('/kit-wishlist')`。
- **i18n**: 既存の `t('wishlist')` ラベルを流用(Colorack側と同名で問題ない。ドロワーはモードごとに表示が分かれるため衝突しない)。

## エラー処理・整合性

- 購入済みへの移行は INSERT → DELETE の順で行い、Undo は逆順(kitsのINSERT行をidで削除 → wishlistへ再INSERT)。wishlist.tsx の `markPurchased` と同じパターン。
- デフォルトのキットボックスは既存ヘルパー(`lib/db.ts` の kit_boxes 先頭取得ロジック)を流用する。

## テスト・検証

- `npx tsc --noEmit` 通過。
- Expo Goでの手動確認: 登録→一覧表示→ソート/フィルター→購入済みスワイプでキット一覧(積みプラ)に現れる→Undoで戻る→削除とUndo→ドロワーに件数付きで表示され、開いている間はKitrackドロワーになる。

## スコープ外

- 買い物リスト項目の編集・写真添付・詳細モーダル。
- Colorack側 wishlist の変更。
