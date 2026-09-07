# Photo Metadata Authority Design

## Goal

スタンダードプランからライトプランへ変更した端末で写真を削除したとき、Firestore に残る古い写真参照を更新し、後日の別端末復元で削除済み写真が復活しないようにする。同時に、再インストール直後など写真メタデータを持たないライト端末が、クラウド上の写真参照を空配列で消すことを防ぐ。

## Scope

- 所有キットの `kitPhotos` と購入候補の `kitWishlistPhotos` を同じ規則で扱う。
- 写真本体のアップロードとダウンロードは引き続きスタンダードプラン限定とする。
- Firestore のバックアップスキーマと SQLite スキーマは変更しない。
- Storage 上の孤児オブジェクト削除は対象外とする。
- プライバシーポリシー更新、`main` 統合、実DB移行検証は後続タスクとする。

## Root Cause

`buildBackupSnapshot()` は `hasPhotoBackup=false` のとき `kitPhotos` と `kitWishlistPhotos` を省略し、`pushBackupToFirestore()` は `merge: true` で書き込む。この組み合わせはプラン降格時に既存のクラウド写真を保護するが、ライト期間中にローカル写真を削除してもクラウド配列が更新されない。

親キットまたは購入候補が残っている場合、古い写真参照は stale 判定で除外されない。スタンダードへ再加入して別端末で復元すると、削除済み写真が再挿入される。

## Chosen Design

端末の写真メタデータが対象ユーザーのクラウド状態と同期済みであることを、`app_settings` のユーザーID付きフラグで記録する。

```ts
const PHOTO_METADATA_AUTHORITY_UID_KEY = 'cloud_backup_photo_metadata_authority_uid';
```

この値が現在の Firebase UID と一致する端末だけを「写真メタデータ正本端末」とする。

### Snapshot inclusion rule

`buildBackupSnapshot()` は次のどちらかを満たす場合だけ、アップロード済み写真行を読み取り、`kitPhotos` と `kitWishlistPhotos` を必ず含める。

1. 現在 `hasPhotoBackup=true` である。
2. `PHOTO_METADATA_AUTHORITY_UID_KEY` が現在の Firebase UID と一致する。

2を満たすライト端末では写真本体をアップロードしない。既存の `synced_at IS NOT NULL AND storage_path IS NOT NULL` 行から参照配列だけを作る。写真をすべて削除した場合は両配列の少なくとも該当配列を空配列として書き込み、Firestore の古い参照を削除する。

どちらも満たさないライト端末は従来どおり写真配列自体を省略し、`merge: true` によりクラウド上の参照を保護する。

### Authority transitions

| Event | Result |
|---|---|
| スタンダードで写真アップロードとFirestore書き込みが成功 | 現在UIDを正本フラグへ保存 |
| スタンダードでクラウド復元が成功 | 復元した写真メタデータが完全なので現在UIDを保存 |
| ライトでクラウド復元が成功 | 写真を復元しないため正本フラグを空文字へ解除 |
| スタンダードからライトへ変更 | フラグを維持。既存の同期済み写真参照を更新可能にする |
| Firebaseアカウント切替 | UID不一致により正本扱いしない |
| 再インストール | フラグが存在しないため正本扱いしない |
| バックアップまたは復元が失敗 | フラグを変更しない |

### Push ordering

`pushBackupToFirestore()` は現在と同じ順序を維持する。

1. アカウント、エンタイトルメント、復元準備、ローカルデータ所有者を検証する。
2. `hasPhotoBackup` を一度だけ取得し、このpush全体の判定値として固定する。
3. 2がtrueの場合だけ未同期写真をStorageへアップロードする。
4. 2の固定値と正本フラグを使い、Snapshot inclusion rule に従ってスナップショットを作る。
5. Firestoreへ `merge: true` で書き込む。
6. UIDが変わっていないことを再検証する。
7. 2がtrueだった場合だけ、正本フラグへUIDを保存する。
8. 最終バックアップ日時を保存する。

Firestore書き込みより前に正本化しない。書き込み失敗時に、未同期のローカル状態を正本として扱わないためである。
push途中でRevenueCatの通知が到着しても、アップロード・スナップショット・正本化の判定を混在させない。

### Restore ordering

`restoreFromSnapshotUnlocked()` は既存の写真ダウンロード、排他DBトランザクション、古いローカルファイル清掃を完了した後に正本フラグを更新する。

- `hasPhotoBackup=true`: `expectedUid` を保存する。
- `hasPhotoBackup=false`: 空文字を保存する。

復元途中でダウンロードまたはDB更新に失敗した場合は、既存のロールバック動作を維持し、正本フラグも変更しない。

## Rejected Alternatives

### Always include photo arrays

実装は最小だが、ライトプランで再インストールした端末や写真なし復元を行った端末が空配列を送信し、クラウド写真参照を消すため不採用。

### Photo deletion tombstones

削除履歴テーブル、バックアップスキーマ追加、復元後のtombstone継承、肥大化対策が必要になる。現行DBには同期済み写真行と明示的な正本判定に必要な情報があるため過剰であり不採用。

### Delete Storage objects immediately

複数端末が同じStorage参照を使用し得るため、クライアント単独で即時削除すると別端末を破壊する。既存方針どおり、孤児整理は将来のサーバーサイド処理へ委ねる。

## Files

- Modify: `lib/cloudBackup.ts`
  - 正本フラグ定数と判定を追加する。
  - 正本ライト端末でも写真参照行を読み取る。
  - push成功時とrestore成功時の状態遷移を追加する。
- Modify: `lib/cloudBackup.test.cjs`
  - 正本ライト端末が現在の写真配列を送る回帰テスト。
  - 写真削除後に空配列を送る回帰テスト。
  - 非正本ライト端末が写真フィールドを省略する保護テスト。
  - push失敗時に正本化しないテスト。
  - Standard/Light復元成功時の正本化・解除テスト。

## Test Scenarios

1. Standardでpush成功後、正本フラグへ現在UIDが保存される。
2. Firestore書き込み失敗時、正本フラグは保存されない。
3. 正本ライト端末は既存の所有キット写真と購入候補写真を含める。
4. 正本ライト端末で購入候補写真を削除すると `kitWishlistPhotos: []` が生成される。
5. 非正本ライト端末は `kitPhotos` と `kitWishlistPhotos` を持たない。
6. Standard復元成功後、正本フラグへ `expectedUid` が保存される。
7. Light復元成功後、正本フラグが解除される。
8. 復元失敗時、正本フラグは変更されない。
9. 既存のスナップショットv1-v7復元テストと全テストが引き続き成功する。

## Acceptance Criteria

- Standardで同期した購入候補写真をLight期間中に削除し、Lightバックアップを実行した後、別端末のStandard復元でその写真が復活しない。
- 新規Light端末はクラウド上の既存写真参照を消さない。
- 写真アップロード権限はスタンダードプランに限定されたままである。
- 所有キット写真と購入候補写真で挙動が一致する。
- `npm run test`、`npm run typecheck`、`git diff --check` が成功する。
