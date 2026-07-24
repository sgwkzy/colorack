# キット写真バックアップ 不具合修正(C-1/I-2) 設計

## 背景・目的

`feature/cloud-backup`ブランチ(サブスク基盤+キット写真バックアップ、フェーズ1・2実装済み・未リリース)に対して多エージェントレビューを実施したところ、設計レベルの不具合が2件見つかった。

- **C-1(Critical)**: スタンダード→ライトへのプラン降格後、次回の自動バックアップが`pushBackupToFirestore()`の`.set({...snapshot})`でFirestoreドキュメント全体を置換し、`buildBackupSnapshot()`が返す`kitPhotos: []`によってクラウド上の既存写真参照が空で上書きされる。Storage側の写真実体は残るが参照が失われ、再課金しても通常の復元フローでは辿り着けなくなる。
- **I-2(Important)**: `lib/kitPhotoBackup.ts`の`kitPhotoStoragePath()`がローカルファイル名(`persist()`が生成する`${Date.now()}-${random}.jpg`)からStorageキーを導出しており、復元時にダウンロードしたファイルも同じ名前でローカル保存するため、端末をまたいで同一Storageオブジェクトを共有してしまう。片方の端末で写真を削除すると、もう片方の端末が依存していた実体も消える。

この機能はまだ本番リリースされておらず(RevenueCatのAPIキーは未設定のプレースホルダのまま)、実運用ユーザーが存在しないため、後方互換の移行処理は不要と判断する。

## スコープ

### 今回やること

- C-1: `pushBackupToFirestore()`を`merge: true`書き込みに変更し、`buildBackupSnapshot()`が`hasPhotoBackup=false`時に`kitPhotos`キー自体を省略するようにする
- I-2: `kit_photos`テーブルに`storage_path`列を新設し、Storage上の位置をローカルファイル名から独立した永続識別子として管理する

### 今回もやらないこと

- I-1(復元中のダウンロード失敗による写真の恒久欠落・回復導線の弱さ)、I-3(コンフリクト復元時の未同期ローカル写真消失)、I-4(エンタイトルメント自己ガードの不統一)、I-5(起動シーケンスの耐障害性)、I-6(RevenueCat本番キー未設定)は対象外。ユーザー指示により今回はC-1・I-2に限定する
- Cloud Functionsによる解約後の孤児クリーンアップの実装(既存スコープ外の方針を維持)

## C-1の修正: Firestore書き込みのmerge化

### `lib/cloudBackup.ts`の変更

`buildBackupSnapshot()`の戻り値オブジェクトで、`kitPhotos`を条件付きスプレッドで組み立てる(`hasPhotoBackup`が`false`のときはキー自体が存在しない状態にする)。

```ts
return {
  schemaVersion: BACKUP_SCHEMA_VERSION,
  // ...(他のフィールドは常に含める、変更なし)
  ...(uid && getEntitlements().hasPhotoBackup
    ? {
        // kitPhotoRows は WHERE synced_at IS NOT NULL AND storage_path IS NOT NULL で取得済み
        // (I-2セクション参照)。row.storage_path は既にStorageの完全パスとして保存されている。
        kitPhotos: kitPhotoRows.map((p) => ({
          kitLocalRef: kitLocalRef(p.kit_id),
          storagePath: p.storage_path,
          sort_order: p.sort_order,
        })),
      }
    : {}),
};
```

`pushBackupToFirestore()`の`firestore().collection('backups').doc(user.uid).set({...})`を`.set({...}, { merge: true })`に変更する。他の全フィールド(boxes/manualPaints/officialPaintNotes/inventory/favorites/wishlist/kitBoxes/kits/kitColors/kitColorPaints等)は`hasPhotoBackup`に関わらず常にオブジェクトに含まれているため、`merge: true`化による既存フィールドへの副作用は無い(常に上書きされる点は変わらない、省略されるのは`kitPhotos`のみ)。

### 完全解約時の扱い(変更なし)

`hasBackup`自体が`false`になった場合(ライトも失効)は、`pushBackupToFirestore()`冒頭の`if (!getEntitlements().hasBackup) return;`で早期returnするため、ドキュメント自体が更新されず凍結される。これは既存の意図した挙動であり、C-1の対象外(元々安全)。

## I-2の修正: `storage_path`列の新設によるローカル/クラウド識別子の分離

### スキーマ変更(`lib/db.ts`)

既存のマイグレーションパターン(`try { ALTER TABLE ... } catch { /* 既にある */ }`)に倣い、`kit_photos`に`storage_path TEXT`列(nullable、デフォルトNULL)を追加する。

### `lib/kitPhotoBackup.ts`の変更

- `kitPhotoStoragePath(uid: string, filename: string): string`: ローカルURIを受け取らず、既に生成済みの識別子(ファイル名)を受け取って文字列を組み立てるだけの純粋関数にする(nullを返さない、常に有効な文字列を返す)。
- `uploadPendingKitPhotos()`: アップロード対象の各行について、`persist()`と同じ命名方式(`${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`)で新規識別子を生成し、アップロード成功時に`synced_at`と同時に`storage_path`もDBへ書き込む。
- `deleteUploadedKitPhoto(storagePath: string | null): Promise<void>`: 引数をローカルURIから`storage_path`に変更する。`null`(未アップロードの写真)の場合は即returnする。
- `downloadKitPhotosForRestore()`: シグネチャは変更なし(`BackupKitPhoto[]`を受け取り`storagePath → ローカルuri`のマップを返す)。ダウンロード先のローカルファイル名は`storagePath`のベースネームを使わず、`persist()`と同じ命名方式で独自に生成する。

### `lib/cloudBackup.ts`の変更

- `buildBackupSnapshot()`: `kit_photos`のクエリに`storage_path`列を追加し、`WHERE synced_at IS NOT NULL AND storage_path IS NOT NULL`で絞り込む。`storagePath`は`kitPhotoStoragePath(uid, row.storage_path)`ではなく、既に完全なパスとして保存されている想定にする(下記「保存形式」参照)。
- `restoreFromSnapshot()`: ダウンロード成功後の`INSERT INTO kit_photos`に`storage_path`列も含め、スナップショットの`photo.storagePath`をそのまま書き込む。

**保存形式の判断**: `kit_photos.storage_path`列には「Storageのフルパス(`users/<uid>/kit-photos/<filename>`)」と「ファイル名のみ」のどちらを保存するか。フルパスを保存する方が、`kitPhotoStoragePath()`のuid依存ロジックを毎回呼び直す必要がなく、復元時にスナップショットの`storagePath`をそのまま書き込むだけで済むためシンプル。**フルパスを保存する方針とする。**

### `components/KitDetailModal.tsx`の変更

`removePhoto`が`deleteUploadedKitPhoto`に渡す引数を、`uri`から`kit_photos`行の`storage_path`に変更する。これに伴い`lib/db.ts`の`KitPhoto`インターフェースと`getKitPhotos()`のSELECT文に`storage_path`を追加する。

## データフロー(修正後)

```
[端末A] persist() → ローカルuri(A固有のファイル名)
  → uploadPendingKitPhotos() → 新規識別子生成 → Storageへアップロード
    → kit_photos.storage_path に完全パスを保存、synced_at打刻

[端末B] restoreFromSnapshot() → snapshot.kitPhotos[].storagePath を参照
  → downloadKitPhotosForRestore() → ダウンロード → 端末B固有の新規ローカルファイル名で保存
    → kit_photos行をINSERT、uri=端末B固有ファイル名、storage_path=snapshotのstoragePathをそのまま保持

[端末A]で個別削除 → kit_photos.storage_path(端末Aが記録した完全パス)を使ってStorage削除
  → 端末Bのkit_photos.storage_pathは同じ値を指しているため、端末Bの参照も破棄すべき実体を正しく特定できる
    (端末間の削除伝播自体は元々スコープ外・Cloud Functions委譲のまま。今回の修正は
    「意図せず共有される」副作用を無くすことが目的ではなく、"ローカルファイル名の偶然の一致"
    という不安定な仕組みを"明示的に保存された同一のStorage参照"という安定した仕組みに
    置き換えることが目的。両端末が同じ写真を指す設計自体は復元の性質上避けられない。)
```

**重要な整理**: I-2の修正は「端末間でStorageオブジェクトが共有されること自体」を無くすものではない(同じ写真をバックアップ/復元しているので、同じStorageオブジェクトを指すのは本来正しい)。修正が無くすのは「ローカルファイル名の偶然の一致という不安定な仕組みに、意図せずデータの生存が依存してしまっている」状態であり、`storage_path`という明示的な列に置き換えることで、将来的に「他端末が参照中の可能性がある共有オブジェクトを不用意に消さない」といった追加の安全策を入れる余地を作る土台にもなる。ただし今回はその追加安全策(参照カウント等)までは実装しない(YAGNI、必要になったら別途検討)。

## テスト・検証方針

- `node node_modules/typescript/bin/tsc --noEmit`
- BOM混入なし
- ユニットテストフレームワークは存在しないため、コードレビューでのロジック確認と、可能であれば手動での実機/Expo Go確認(本セッションでは実行不可)

## 前提・注意点

- この機能は未リリースのため、既存の`storage_path`未設定行(旧スキームでアップロード済みの写真)に対する移行処理は行わない
- `kitPhotoStoragePath()`の呼び出し元がuidを渡す前提は維持されるが、渡す第2引数の意味が「ローカルURI」から「識別子(ファイル名)」に変わる点に注意(Task実装時に全呼び出し元を確認すること)
