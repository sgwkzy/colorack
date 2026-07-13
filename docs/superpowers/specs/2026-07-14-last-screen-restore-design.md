# 起動時の「最後に開いていたボックス」復元 設計

## 背景・目的

現在、アプリを再起動すると常に塗料ボックス一覧(`owned.tsx`)がColorackモードで表示される。`lib/appMode.ts`のドロワーモード(Colorack/Kitrack)は既に永続化されているが、これは「ドロワーの見た目」だけを制御しており、実際に表示される画面(`owned.tsx` vs `kits.tsx`)や選択中のボックスとは連動していない。

ユーザー要望: アプリを閉じた時点で見ていたボックス(塗料/キット、具体的なボックスID、使用済み/完成品画面も含む)を、次回起動時に画面・ドロワー両方で復元したい。

## スコープ

### 今回やること

- 起動時に、最後にフォーカスしていた画面(`owned`/`used`/`kits`/`completed`)と、その時点で選択していたボックスIDを復元する
- 復元先の画面に応じてドロワーのモード(Colorack/Kitrack)も自動的に一致させる
- どの画面であれ実際にフォーカスが当たった時点でドロワーモードを自動同期する仕組みも合わせて入れる(手動でのドロワー切り替えタップだけでなく、実際に見ている画面と常に一致するようにする)

### 今回もやらないこと

- お気に入り・買い物リスト・塗料一覧・設定画面の復元。これらの画面を見ている間は「最後の画面」を更新しない。これらを見てからアプリを閉じた場合、その前に見ていたボックス画面(または使用済み/完成品)に戻る
- キット詳細・塗料詳細などモーダルの開閉状態の復元(スコープ外、モーダルは常に閉じた状態で起動する)

## 仕組み

### 新規persist対象(`app_settings`)

- `last_screen`: `'owned' | 'used' | 'kits' | 'completed'`
- `last_box_id`: 選択中の塗料ボックスID(`'all'`または数値の文字列)
- `last_kit_box_id`: 選択中のキットボックスID(`'all'`または数値の文字列)

### 書き込みタイミング

- `last_box_id`/`last_kit_box_id`: `lib/activeBox.ts`の`setActiveBox`、`lib/activeKitBox.ts`の`setActiveKitBox`に、`lib/appMode.ts`と同じ「変更時にfire-and-forgetで`setSetting`する」パターンを追加する
- `last_screen`: `owned.tsx`(`InventoryScreen`)と`kits.tsx`(`KitsScreen`)それぞれに、画面フォーカス時に発火する`useFocusEffect`を追加し、`setLastScreen('owned'|'used')`・`setLastScreen('kits'|'completed')`を呼ぶ。**同じタイミングで`setAppMode('colorack'|'kitrack')`も呼ぶ** — これにより、ドロワーの手動トグルだけでなく、実際にどの画面を見ているかに応じてドロワーモードが常に自動補正される

### 新規モジュール: `lib/lastScreen.ts`

```ts
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

`initLastScreen()`は`app/_layout.tsx`の既存の起動シーケンス(`initDB()`後の`Promise.all([initTheme(), initLocale(), initUiPrefs(), initAppMode()])`)に加える。`getRestoreTarget()`は同期関数で、`ready`になった時点で確定している値を読むだけなので、`(tabs)/_layout.tsx`のコンポーネント関数内で直接呼べる。

### `(tabs)/_layout.tsx`: 動的な初期画面

```tsx
const restoreTarget = getRestoreTarget();
...
<Tabs
  initialRouteName={restoreTarget?.screen}
  screenOptions={{ ... }}
>
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
  ...(他は変更なし)
</Tabs>
```

`restoreTarget`が`null`(初回起動でまだ何も永続化されていない)の場合、`initialRouteName`は`undefined`になり、現在と同じく`owned`がデフォルトで開く。

**この方式ならチラつきが発生しない**: `<Tabs>`は最初から正しい画面でマウントされるため、「一旦`owned`が表示されてから切り替わる」という現象が原理的に起きない。`owned.tsx`/`kits.tsx`は既にURLの`boxId`パラメータでボックスを復元するロジックを持っているため、両ファイルとも変更不要。

### `owned.tsx`/`kits.tsx`への追加

各ファイルの既存の`useFocusEffect`とは別に、以下を追加する。

```ts
// owned.tsx (InventoryScreen内)
useFocusEffect(useCallback(() => {
  setLastScreen(usedScreen ? 'used' : 'owned');
  setAppMode('colorack');
}, [usedScreen]));
```

```ts
// kits.tsx (KitsScreen内)
useFocusEffect(useCallback(() => {
  setLastScreen(completedScreen ? 'completed' : 'kits');
  setAppMode('kitrack');
}, [completedScreen]));
```

## 検証方法

- `npx tsc --noEmit`
- UTF-8 BOMなし確認
- 実機での確認: キットボックスAを開いた状態でアプリを完全終了→再起動→キットボックスAが開いた状態・ドロワーがKitrackモードで起動することを確認。塗料ボックスBを開いた状態で同様に確認。使用済み画面・完成品画面を見ている状態で終了→再起動でそれぞれの画面に戻ることを確認。お気に入り画面を見ている状態で終了した場合は、その前に見ていたボックス画面に戻ることを確認(お気に入り自体は復元対象に含めない)。
