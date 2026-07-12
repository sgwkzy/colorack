# キット使用色: 複数塗料の混色登録 設計

## 背景・目的

`docs/superpowers/specs/2026-07-12-kit-management-design.md`で実装したキット機能では、「使用する色」は`kit_paints`テーブルに1塗料=1行として登録するだけの単純な仕組みだった(`docs/superpowers/specs/2026-07-13-kit-multiphoto-fields-design.md`の「ネクストアクション」で明示的に先送りにしていた「混色登録」に該当)。

実機でのテストを経て、以下の要望が出た:

- 色に名前(色名)を付けたい
- 単色をサッと登録することも、複数の塗料を混色として登録することも、同じ画面で完結させたい(選んでいる途中で「やっぱり混ぜたい」となるケースが多いため)
- 混色時は各塗料の配合割合(%)を指定でき、選択中もリアルタイムで混色プレビューを確認したい
- 塗料の選択は「一覧からドリルダウン選択」(ブランド→シリーズ→塗料)と「近似色検索」(HEX/カメラ→ΔEランキング)の2経路
- 混色プレビューの計算はKubelka-Munk理論に基づかせたい

## スコープ

### 今回追加するもの

- `kit_colors`(色エントリ: 色名・メモ)+ `kit_color_paints`(構成塗料・配合割合)の新データモデル
- 新規`KitColorComposerModal.tsx`: 色名入力 + 塗料ピッカー(一覧ドリルダウン/近似色検索のタブ)+ 画面下部の折りたたみアコーディオン(現在の混色プレビュー・登録済み構成塗料の割合編集/削除)+ 保存
- 新規`lib/colorMix.ts`: 単一定数Kubelka-MunkによるRGB加重混色計算
- 新規`KitColorRow.tsx`: `KitDetailModal`の「使用する色」一覧の1行表示(混色スウォッチ・色名・構成塗料の内訳・メモ編集・削除)
- 既存`kit_paints`データの自動移行(初回起動時、1塗料1行→`kit_colors`1件+`kit_color_paints`1件・ratio=1.0)

### 今回もやらないこと

- 保存後の構成塗料・割合の変更(削除して作り直す運用。色名・メモの編集のみ可)
- 分光反射率データを使う厳密なKubelka-Munk(元データがHEX値のみのため対象外。後述の近似式を採用)
- 塗料自体の隠蔽力・展色剤などを考慮した高度な混色シミュレーション

## データモデル

```sql
CREATE TABLE kit_colors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kit_id INTEGER NOT NULL,
  name TEXT,               -- 色名。空なら表示時に1色目(sort_order最小)の塗料名で代替
  note TEXT,
  added_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE kit_color_paints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kit_color_id INTEGER NOT NULL,
  paint_id INTEGER NOT NULL,
  ratio REAL NOT NULL,          -- 0〜1。保存時に合計1.0へ正規化
  sort_order INTEGER NOT NULL DEFAULT 0
);
```

`kit_paints`テーブルは廃止する。既存行がある端末向けに、初回起動時ロジックで自動移行:
`kit_paints`の各行 → `kit_colors`1件(`name` = そのカタログ塗料の`name_ja`、`note`はそのまま引き継ぎ)+ `kit_color_paints`1件(`ratio = 1.0`、`sort_order = 0`)。移行後に`kit_paints`テーブルをDROPする。移行は`kit_paints`テーブルがまだ存在する場合のみ実行し(`pragma_table_info`等で存在確認)、二重実行を防ぐ。

`deleteKit`のカスケード、および`KitBoxOptions.tsx`のキットボックス削除カスケードは、`kit_paints`の削除を`kit_color_paints`→`kit_colors`の削除に置き換える(既存の`kit_paints`/`kit_photos`削除と同様の子→親の順序)。

## 画面構成: `KitColorComposerModal.tsx`

`KitPaintPickerModal.tsx`を置き換える新規モーダル。

```
┌─────────────────────────┐
│ 色名 [___________]       │ ← 任意。空なら保存時に1色目塗料名を採用
├─────────────────────────┤
│ [一覧から選択] [近似色検索] │ ← タブ
│                          │
│   (HierarchyBrowser or   │ ← メインエリア。塗料をタップで
│    ColorMatcher を再配線) │   下のアコーディオンに追加
│                          │
├─────────────────────────┤
│ ▼ 現在の色 ■■■           │ ← アコーディオン。閉じていても
├─────────────────────────┤    スウォッチは常時見える
│ [展開時]                 │
│  ■ 白 GX1        [70]%  🗑│
│  ■ 赤 GX3        [30]%  🗑│
├─────────────────────────┤
│         [保存]           │
└─────────────────────────┘
```

- 塗料ピッカーの2タブは既存コンポーネントをそのまま再配線する: 「一覧から選択」= `components/AddPaint/HierarchyBrowser.tsx`(ブランド→シリーズ→塗料のドリルダウン)、「近似色検索」= `components/AddPaint/ColorMatcher.tsx`(HEX入力/カメラ→ΔEランキング)。どちらも`onSelect(paint)`/`onSelectView(paint)`/`onRequestClose`という同一のprops形状を持つため、`onSelect`を「アコーディオンの構成塗料リストに追加する」処理に差し替えるだけで流用できる。新規の検索ロジックは書かない。
- 塗料は最大5つまで(構成塗料が5件に達したら「追加」導線を無効化)。
- 塗料を追加/削除するたびに、全構成塗料の割合を均等割りへリセットする(2件→50/50、3件→33/33/34など)。その後は各行の%入力で自由に編集できる。
- 保存時、入力された割合の合計が100%でなければ、比率を保ったまま合計100%へ自動正規化する(例: 2, 1 と入力→67%/33%として保存)。エラー表示で止めない。
- 保存ボタンは構成塗料が1件以上のとき活性化。塗料が1件のまま保存すれば、従来通りの「単色登録」相当になる(ratio=1.0の`kit_colors`エントリ)。
- 画面を閉じる際(保存せずキャンセル)は、追加していた構成塗料の選択状態を破棄するだけでよい(ファイルの生成が伴わないため、キット写真機能のような孤立ファイル対策は不要)。

## 混色プレビューの計算: `lib/colorMix.ts`

Kubelka-Munk理論は本来、波長ごとの吸収係数K・散乱係数Sを使う減法混色モデルで、厳密な実装には分光反射率データが必要。このアプリが持つ色情報は塗料ごとのHEX値(sRGB3チャンネル)のみのため、真の分光K-Mは実装しない。代わりに、R/G/B各チャンネルを疑似反射率とみなして単一定数K-M(不透明・自己下地=masstoneモデル)をチャンネルごとに適用する近似を採用する。

```ts
// 反射率 r (0〜1、両端はクランプ) から K/S を求める
function reflectanceToKS(r: number): number {
  const clamped = Math.min(0.999, Math.max(0.001, r));
  return (1 - clamped) ** 2 / (2 * clamped);
}

// K/S から反射率 r (0〜1) を復元する
function ksToReflectance(ks: number): number {
  return 1 + ks - Math.sqrt(ks * ks + 2 * ks);
}

// 1チャンネル分の加重K-M混色
function mixChannel(values: { channel: number; ratio: number }[]): number {
  const totalRatio = values.reduce((sum, v) => sum + v.ratio, 0) || 1;
  const ksAvg = values.reduce((sum, v) => sum + reflectanceToKS(v.channel / 255) * (v.ratio / totalRatio), 0);
  return Math.round(ksToReflectance(ksAvg) * 255);
}

// 塗料のHEXと割合(0〜1、合計は問わない)から混色後のHEXを算出
export function mixHexColors(paints: { hex: string; ratio: number }[]): string | null {
  const rgbList = paints.map((p) => ({ rgb: hex_to_rgb(p.hex), ratio: p.ratio })).filter((p) => p.rgb !== null);
  if (rgbList.length === 0) return null;
  const r = mixChannel(rgbList.map((p) => ({ channel: p.rgb!.r, ratio: p.ratio })));
  const g = mixChannel(rgbList.map((p) => ({ channel: p.rgb!.g, ratio: p.ratio })));
  const b = mixChannel(rgbList.map((p) => ({ channel: p.rgb!.b, ratio: p.ratio })));
  return '#' + [r, g, b].map((v) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0')).join('');
}
```

`hex_to_rgb`は既存の`lib/color.ts`のものを再利用する(`lib/colorMix.ts`から`import`)。この関数は保存しない — `KitColorComposerModal`(選択中のリアルタイムプレビュー)と`KitColorRow`(一覧表示のスウォッチ)の両方が、都度この関数を呼んで描画時に計算する。

懸念点(実装前に共有済み・対応方針):
1. 分光データではなくRGB3チャンネルでの近似であること — 単純なRGB平均より減法混色らしい結果(例: 青+黄→緑寄り)になるが、厳密な予測ではない
2. 反射率が0または1に近い極端な色でK/Sが発散しうるため、`reflectanceToKS`で0.001〜0.999にクランプする
3. 隠蔽力・粒子径・展色剤などはモデル化されない

## `KitDetailModal.tsx`の「使用する色」欄

`getKitPaints`/`KitPaintRow`/`KitPaintPickerModal`を、`getKitColors`/`KitColorRow`/`KitColorComposerModal`に置き換える。

`KitColorRow.tsx`(`KitPaintRow.tsx`を置き換え):
- 混色後スウォッチ(`mixHexColors`の結果。構成塗料1件なら実質その塗料の色そのまま)
- 色名(`kit_colors.name`が空なら構成塗料の1色目の名前を表示)
- 内訳サブテキスト(例: 「白 70% + 赤 30%」)
- メモ入力(既存の`note`欄と同様、blur時保存)
- 削除ボタン(色エントリごと。構成塗料の個別削除は不可、削除して`KitColorComposerModal`で作り直す)

## `lib/db.ts`の変更点

- `kit_paints`のCREATE TABLE削除、`kit_colors`/`kit_color_paints`のCREATE TABLE追加
- 起動時マイグレーション(`kit_paints`が存在すれば`kit_colors`/`kit_color_paints`へ変換後、`kit_paints`をDROP)
- `KitPaintRow`インターフェース・`getKitPaints`・`addKitPaint`・`updateKitPaintNote`・`removeKitPaint`を削除
- 新規: `KitColorSummary`(色エントリ+構成塗料配列の型)、`getKitColors(kitId)`、`addKitColor(kitId, name, note, paints: {paintId, ratio}[])`(色エントリ+構成塗料をトランザクションでINSERT)、`updateKitColorName(kitColorId, name)`、`updateKitColorNote(kitColorId, note)`、`removeKitColor(kitColorId)`(構成塗料→色エントリの順で削除)
- `deleteKit`のカスケードに`kit_color_paints`→`kit_colors`の削除を追加(`kit_paints`削除を置き換え)

## `components/KitBoxOptions.tsx`の変更点

キットボックス削除時のカスケードクエリを、`kit_paints`から`kit_color_paints`/`kit_colors`(対象ボックス内の全キットの全色エントリ)に置き換える。写真の孤立防止と同じ「トランザクション確定後にファイル削除」の考え方は、この変更では写素材がないため関係しない(色データはDBのみ)。

## 翻訳

新規に必要になりそうなキー(実装時に確定): 「割合」「登録済みの塗料」「塗料を追加」「一覧から選択」「近似色検索」「現在の色」など。「色名」は既存の`colorName`キー(現状はカタログ内検索のプレースホルダとして使用)をそのまま意味的に流用できる。

## 検証方法

- `npx tsc --noEmit`
- 翻訳ファイルのキー整合性確認、UTF-8 BOMなし確認
- 実機での確認: 色名を入力→一覧ドリルダウンで塗料を1つ選択→保存(単色登録として動作することを確認)。別の色を作成し、一覧ドリルダウンと近似色検索を組み合わせて2〜5塗料を選択→割合を編集→アコーディオンが閉じていてもプレビュースウォッチが見えることを確認→保存。保存した色がキット詳細に混色スウォッチ・内訳付きで表示されることを確認。色名・メモを編集して保持されることを確認。色エントリを削除して一覧から消えることを確認。既存の`kit_paints`データ(あれば)が起動後に`kit_colors`へ正しく移行されていることを確認。
