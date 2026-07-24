# キット写真バックアップ 残存指摘対応(I-1/I-3/I-4/I-5) 設計

## 背景・目的

`feature/cloud-backup`ブランチの多エージェントレビューで見つかった6件の指摘(C-1, I-1〜I-6)のうち、C-1とI-2は既に修正・push済み。本設計は残りのうち4件(I-1, I-3, I-4, I-5)への対応方針を定める。I-6(RevenueCat本番APIキー未設定)はコード不具合ではなくリリース時の手作業であり、既に`docs/revenuecat-setup-runbook.md`に手順を記載済みのため、今回のスコープ外とする。

## スコープ

### 今回やること

- I-1(修正版): `downloadKitPhotosForRestore()`に1回のリトライを追加し、一時的なネットワーク障害による写真の欠落を減らす
- I-3: コンフリクト復元アラートの文言を強化し、未バックアップ分が失われる旨をより明確に伝える(挙動自体は変更しない)
- I-4: `restoreFromSnapshot()`/`downloadKitPhotosForRestore()`にエンタイトルメント自己ガードを追加する
- I-5: `app/_layout.tsx`の起動シーケンスで、`initAuth()`/`initAnalytics()`の失敗がアプリ全体の起動を妨げないようにする

### 今回もやらないこと

- I-6(RevenueCat本番APIキー未設定): コード不具合ではないため対象外
- クラウドとローカルを突き合わせて不足写真を再ダウンロードする本格的な差分同期機構: `kits`テーブルへの出自(origin)列追加のようなスキーマ変更を伴うため、今回はI-1をスコープダウンした「同一復元内でのリトライ」で対応し、この本格対応は見送る
- I-3で挙動自体(未バックアップ分を破棄すること)を変更すること: 既存の他データ種別(在庫・お気に入り・買い物リスト等)と同じ仕様のため、キット写真だけ特別扱いにしない

## I-1(修正版)の設計: 復元処理内での1回リトライ

**当初の想定との違い**: 当初は「毎回の自動バックアップ循環でクラウドと突き合わせ、ローカルに無い写真を再ダウンロードする」という差分同期方式を検討したが、クラウド側の`kitLocalRef`(例: `kit_47`)を、復元処理が完了し`kitIdByLocalRef`のマッピングが破棄された後の別セッションで、現在の端末のローカル`kit_id`に逆引きする手段が無いことが判明した。これを実現するには`kits`テーブルに出自を記録する列を新設するなどのスキーマ変更が必要になり、単純な不具合修正の範囲を超える。

**採用する方式**: `lib/kitPhotoBackup.ts`の`downloadKitPhotosForRestore()`内、写真1枚ごとのダウンロード処理を最大2回試行するループでラップする。1回目が失敗しても、`kitIdByLocalRef`マッピングは同一の`restoreFromSnapshot()`呼び出し内でまだ有効なため、スキーマ変更無しに再試行できる。2回とも失敗した場合のみ、既存通りログを残してスキップする(その写真は今回の復元では欠落するが、次回ユーザーが再度「クラウドから復元」を試みれば再取得できる、既存のフォールバック経路を維持)。

```ts
export async function downloadKitPhotosForRestore(photos: BackupKitPhoto[]): Promise<Map<string, string>> {
  const localUriByStoragePath = new Map<string, string>();
  if (!storage || photos.length === 0) return localUriByStoragePath;

  const info = await FileSystem.getInfoAsync(KIT_PHOTO_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(KIT_PHOTO_DIR, { intermediates: true });

  for (const photo of photos) {
    const dest = `${KIT_PHOTO_DIR}${generatePhotoFilename()}`;
    let succeeded = false;
    for (let attempt = 0; attempt < 2 && !succeeded; attempt++) {
      try {
        const url = await storage().ref(photo.storagePath).getDownloadURL();
        await FileSystem.downloadAsync(url, dest);
        localUriByStoragePath.set(photo.storagePath, dest);
        succeeded = true;
      } catch (e) {
        if (attempt === 1) console.error('downloadKitPhotosForRestore: failed to download after retry', photo.storagePath, e);
      }
    }
  }
  return localUriByStoragePath;
}
```

## I-3の設計: コンフリクト復元アラートの文言強化

挙動は変更しない。`translations/en.json`/`translations/ja.json`の`cloudRestoreConflictMessage`キーの文言に、未バックアップ分が失われる旨を明記する。

- 現在(ja): 「この端末にもデータがあります。クラウドから復元すると、この端末のデータは置き換えられます。」
- 変更後(ja): 「この端末にもデータがあります。クラウドから復元すると、この端末のデータ(まだバックアップされていない変更を含む)は失われます。」
- 現在(en): "This device also has data. Restoring from cloud will replace this device's data."
- 変更後(en): "This device also has data. Restoring from cloud will permanently replace this device's data, including any changes not yet backed up."

## I-4の設計: エンタイトルメント自己ガードの追加

`lib/cloudBackup.ts`の`restoreFromSnapshot()`冒頭に`if (!getEntitlements().hasBackup) return;`を追加する。`lib/kitPhotoBackup.ts`の`downloadKitPhotosForRestore()`冒頭に`if (!getEntitlements().hasPhotoBackup) return new Map();`を追加する。既存の呼び出し元(`runRestoreDecision()`、`settings.tsx`の`restoreCloudBackup()`、`restoreFromSnapshot()`自身の写真復元ブロック)はすべて既にゲート済みのため、これらの追加は挙動を変えない防御的な変更である。

## I-5の設計: 起動シーケンスの耐障害性回復

`app/_layout.tsx`の`Promise.all([...])`内、`initAuth()`と`initAnalytics()`の呼び出しにそれぞれ`.catch((e) => console.error(...))`を追加し、Promiseの拒否が`Promise.all`全体を拒否させないようにする。これにより、Firebase/RevenueCat/Google Play Servicesのネイティブ呼び出しが実機で失敗しても、`setInitFailed(true)`による全画面クラッシュ表示を避け、認証と無関係なコア機能(カタログ閲覧・在庫管理)を含むアプリ本体は起動できるようにする。

## テスト・検証方針

- `node node_modules/typescript/bin/tsc --noEmit`
- BOM混入なし
- ユニットテストフレームワークは存在しないため、コードレビューでのロジック確認と、可能であれば手動での実機/Expo Go確認(本セッションでは実行不可)

## 前提・注意点

- I-1の修正はあくまで「一時的な」障害に対する緩和策であり、恒久的なネットワーク切断・長時間オフラインといったケースでは引き続き写真が欠落しうる。その場合の回復手段は既存の「コンフリクト時の全件再復元」のみで変更しない
- I-6は本設計のスコープ外。リリース前に`docs/revenuecat-setup-runbook.md`の手順を実施する必要がある点は変わらない
