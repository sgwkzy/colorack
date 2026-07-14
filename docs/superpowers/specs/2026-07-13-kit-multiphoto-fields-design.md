# キット機能拡張: シリーズ/種別欄・複数写真対応 設計

## 背景・目的

`docs/superpowers/specs/2026-07-12-kit-management-design.md`で実装したキット管理機能(PR #22、未マージ)に対し、実機での動作確認中にユーザーから追加要望が出た:

- キット登録時に「シリーズ」「種別」を入力できるようにしたい
- 写真を複数枚(最大10枚)登録でき、1枚目がサムネイルになるようにしたい
- 写真の並び替えは、削除して撮り直す運用で代替する(専用UIは不要)

この機能はまだPRがマージされておらず、いずれのビルド(TestFlight/Google Play含む)にも含まれていないため、実データの移行を考慮せずスキーマをクリーンに変更できる。

## スコープ

### 今回追加するもの

- `kits`テーブルに`series`(シリーズ)・`category`(種別、ジャンル分類の自由入力)列を追加
- キット追加/詳細フォームに両欄を追加(スケール欄と同様、任意入力の自由テキスト)
- 写真を単一(`kits.photo_uri`)から複数(新規`kit_photos`テーブル、最大10枚)に変更
- 1枚目(登録順で最も古い/sort_order最小)がキット一覧のサムネイルとして使われる
- 写真の追加・削除UI(グリッド表示、最大10枚)

### 今回もやらないこと

- 写真の並び替えUI(削除→再追加で代替、明示的にユーザーが選択)
- 種別の固定選択肢化(自由入力のまま、将来の絞り込み機能検討時に再考)

## データモデル変更

既存の`kits`テーブル定義を変更(この機能は未リリースのためクリーンに変更可能):

```sql
-- kits テーブルに列追加
ALTER TABLE kits ADD COLUMN series TEXT;
ALTER TABLE kits ADD COLUMN category TEXT;

-- photo_uri は新規テーブルに置き換えるため、CREATE TABLE定義から削除
-- (既存のCREATE TABLE IF NOT EXISTS文からphoto_uri列を除いた形に書き換える)

CREATE TABLE IF NOT EXISTS kit_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kit_id INTEGER NOT NULL,
  uri TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at TEXT DEFAULT (datetime('now'))
);
```

`kit_photos`は`kit_paints`と同じ「親キットに対する子テーブル」パターン。`sort_order`は追加順(0始まりの連番)、1枚目(`sort_order`が最小、実質的には`MIN(sort_order)`)がサムネイルとして扱われる。サムネイル判定は常に「その時点で残っている写真の中でsort_order最小のもの」を都度クエリで求める方式とし、専用のフラグ列は持たない。これにより、1枚目を削除した場合は自動的に次に古い写真がサムネイルに繰り上がる(特別なリバランス処理は不要)。

`KitDetail`インターフェース(`lib/db.ts`)から`photo_uri`フィールドを削除。写真は`getKitPhotos(kitId)`で別途取得する。

## 画面構成の変更

| ファイル | 変更内容 |
|---|---|
| `lib/db.ts` | `kits`テーブルに`series`/`category`列追加、`photo_uri`列を`CREATE TABLE`定義から削除、`kit_photos`テーブル追加。`KitDetail`から`photo_uri`削除。`updateKitPhoto`を削除し、代わりに`getKitPhotos`/`addKitPhoto`/`removeKitPhoto`を追加。`deleteKit`のトランザクションに`kit_photos`の削除も追加(`kit_paints`と同様、`kits`より先に削除) |
| `components/KitPhotoGrid.tsx`(新規) | 最大10枚の正方形サムネイルグリッド。各サムネに削除ボタン(✕)、10枚未満の時のみ「追加」タイル表示。追加タップで既存の`pickKitPhotoFromCamera`/`pickKitPhotoFromLibrary`(`lib/kitPhoto.ts`、変更不要)を使ったカメラ/ギャラリー選択の`ActionSheet`を表示。1枚目は視覚的にわずかに強調(枠線など)してサムネイル扱いであることを示す |
| `components/KitPhotoPicker.tsx` | 役目を`KitPhotoGrid.tsx`に譲るため削除(単一写真という前提が変わったため) |
| `components/AddKitModal.tsx` | 「シリーズ」「種別」の入力欄をスケール欄の下に追加。`KitPhotoPicker`を`KitPhotoGrid`に置き換え、フォーム内でローカルに写真URIの配列(最大10件)を保持し、保存時にキット行のINSERT後、各写真をsort_order付きでINSERT |
| `components/KitDetailModal.tsx` | 「シリーズ」「種別」を表示・編集可能に(既存のnote欄と同様のインライン編集)。`KitPhotoPicker`を`KitPhotoGrid`に置き換え、`getKitPhotos`で読み込み、追加/削除は都度DBに反映(`addKitPhoto`/`removeKitPhoto`) |
| `app/(tabs)/kits.tsx` | 一覧のサムネイルクエリを、`kit_photos`から1枚目を取るサブクエリに変更 |
| `components/KitBoxOptions.tsx` | ボックス削除時の写真クリーンアップクエリを、`kits.photo_uri`ではなく`kit_photos`(対象ボックス内の全キットの全写真)を対象にするよう修正 |
| `translations/ja.json`/`en.json` | 新規キー`category`(「種別」/"Category")のみ追加。「シリーズ」は既存の`series`キーを流用 |

## 技術メモ

- `lib/kitPhoto.ts`の`pickKitPhotoFromCamera`/`pickKitPhotoFromLibrary`/`deleteKitPhoto`は変更不要。複数枚対応は呼び出し側(`KitPhotoGrid`)がこれらを複数回呼ぶだけで実現する
- キット削除時(`deleteKit`)・キットボックス削除時(`KitBoxOptions`のカスケード)は、DBから写真URIの一覧を取得してから、DBトランザクション確定後に各ファイルを`deleteKitPhoto`で削除する(既存の単一写真版と同じ「トランザクション確定後に削除」の順序を守る)
- サムネイル取得のSQL例: `(SELECT uri FROM kit_photos WHERE kit_id = kits.id ORDER BY sort_order, id LIMIT 1) AS thumb_uri`

## 検証方法

- `npx tsc --noEmit`
- 翻訳ファイルのキー整合性確認、UTF-8 BOMなし確認
- 実機での確認: キット追加時にシリーズ/種別を入力して保存→詳細で反映確認。写真を3枚追加→一覧で1枚目がサムネイルとして表示されることを確認。写真を1枚削除→残りが正しく表示されることを確認。10枚まで追加できること、11枚目は追加ボタンが出ないことを確認。キット削除・キットボックス削除で写真ファイルが孤立しないことを確認(前回の全体レビューで修正した孤立化防止ロジックと同様の考え方を維持)
