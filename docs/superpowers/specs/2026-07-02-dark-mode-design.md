# ダークモード対応 設計書

日付: 2026-07-02

## 目的

Colorackアプリにダークモード対応を追加する。ユーザーはライト/ダーク/システム追従の3択から選べ、選択は端末再起動後も保持される。

## 要件

- 切替方式: 設定画面での手動トグル(ライト/ダーク/システムに従う)+ システム設定への自動追従(「システムに従う」選択時)。
- 選択内容は永続化し、アプリ再起動後も維持する。
- 既存の言語切替(`lib/i18n.ts` の `useLocale()` パターン)と一貫したUXにする。

## アーキテクチャ

React Contextは導入せず、既存の `lib/i18n.ts` の「モジュールスコープのlistener Set + `useReducer`で強制再描画」パターンを流用する。理由: 依存追加なしで実現でき、既存コードとの実装パターンの一貫性が高い。

## データモデル・永続化

- `app_settings` テーブル(既存、`lib/db.ts`)に `theme_mode` キーを追加。値は `'light' | 'dark' | 'system'`、デフォルト `'system'`。
- 永続化・読み込みは既存の `getSetting` / `setSetting` をそのまま利用する。
- `app/_layout.tsx` の `initDB()` 完了待ち(`ready` state)と同じタイミングで `theme_mode` をDBから読み込み、`ready` になる前に確定させることで初回描画時のチラつきを防ぐ。

## lib/theme.ts の変更

- 現行の単一 `colors` オブジェクトを `lightColors` / `darkColors` の2パレットに分割する(キー構成は同一)。
  - アクセント色(`primary` / `danger` / `inUse` / `usedUp` 等)はダーク背景でのコントラストを確認の上、必要なら微調整。
  - `surface` / `surfaceAlt` / `border` / `borderLight` / `text` 系はダーク用の配色を新規定義する。
- `Appearance.getColorScheme()` を購読し、`theme_mode === 'system'` の場合は端末側の切替にリアルタイムに追従する。
- 新規エクスポート:
  - `useTheme(): { colors: Colors; mode: ThemeMode; isDark: boolean }` — 現在のテーマを取得し、変更時に自動再描画されるフック。
  - `setThemeMode(mode: ThemeMode): void` — モード変更をメモリに反映し、DBに永続化し、全購読コンポーネントに通知する。
  - `initTheme(): Promise<void>` — アプリ起動時に一度だけ呼び、DBから永続化済みモードを読み込み、`Appearance` の変更リスナーを登録する。
- モードから実際のダーク/ライト判定への変換ロジック(`mode` + `systemScheme` → `isDark`)は独立した純粋関数として実装する(テスト対象にするため)。

## 画面側の変更(機械的移植)

対象: `colors.x` を直接参照している全19ファイル・125箇所(`app/(tabs)/*.tsx`、`components/**/*.tsx`)。

パターン(全ファイル共通):
1. コンポーネント内冒頭で `const { colors } = useTheme();` を取得する。
2. モジュール直下にあった `const styles = StyleSheet.create({...})` を、コンポーネント内で `const styles = useMemo(() => StyleSheet.create({...}), [colors]);` に変更する(スタイル定義の中身自体は変更しない)。
3. `colors.x` の参照はそのまま(取得元がimportからフック経由に変わるのみ)。

代表ファイル(同一パターンが他16ファイルにも適用される):
- `app/(tabs)/owned.tsx`(26箇所、最大規模)
- `components/PaintFormFields.tsx`
- `components/FilterModal.tsx`

## 設定画面UI

`app/(tabs)/settings.tsx` の言語切替セクションの下に、新セクション「テーマ」を追加する。
- ライト / ダーク / システムに従う の3択(横並びの `TouchableOpacity` 3つ、選択中はハイライト表示)。
- 選択時に `setThemeMode()` を呼ぶ。
- 既存の `resetBtn` スタイルと統一感のある見た目にする。

## その他

- `app/_layout.tsx` に `<StatusBar style={isDark ? 'light' : 'dark'} />` を追加し、ステータスバーの視認性をテーマに追従させる。
- `App.tsx`(expo-routerでは未使用のボイラープレート)は対象外。

## エラーハンドリング

- `theme_mode` の値がDBに存在しない、または不正な値の場合は `'system'` にフォールバックする。
- `initTheme()` 内のDB読み込み失敗時はデフォルト(`'system'`)のまま起動を継続し、`console.error` でログのみ出す(致命的にしない)。

## テスト

- 自動テスト基盤(jest等)は現状リポジトリに存在せず、本機能のためだけに新規導入はしない。
- `lib/theme.ts` 内の「`mode` + `systemScheme` → `isDark`」判定を行う純粋関数に対し、`__DEV__` 時のみ実行される `assert` ベースの自己チェックを1つ追加する(最小限のセーフティネット)。
- 実機(Expo Go)での手動確認:
  - 設定画面でライト/ダーク/システム追従を切り替え、全画面の配色が即座に切り替わること。
  - 「システムに従う」選択時、端末側のダークモード切替に追従すること。
  - アプリ再起動後も選択したモードが保持されていること。

## スコープ外

- テーマごとのアイコン切替、アニメーション付き切替、アクセントカラーのカスタマイズ機能は対象外。
- jest等のテスト基盤の新規整備は対象外(将来的に別タスクとして検討)。
