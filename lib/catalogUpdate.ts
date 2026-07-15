// lib/catalogUpdate.ts
// 公式カタログのリモート更新(GitHub Releases配信)。docs/catalog-release-runbook.md 参照。
import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { applyCatalogUpdate, getCatalogAppliedVersion, getSetting, setSetting, SeedRow } from './db';

const MANIFEST_URL = 'https://raw.githubusercontent.com/sgwkzy/colorack/master/catalog-releases/latest.json';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MIN_EXPECTED_ROWS = 100;

export type CatalogManifest = {
  version: number;
  sqlite_url: string;
  md5: string;
  size_bytes: number;
  row_count: number;
  released_at: string;
  notes?: string;
};

export type CatalogUpdateStage = 'downloading' | 'verifying' | 'applying';

async function fetchManifest(): Promise<CatalogManifest> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(MANIFEST_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status}`);
    const json = await res.json();
    if (typeof json?.version !== 'number' || typeof json?.sqlite_url !== 'string' || typeof json?.md5 !== 'string') {
      throw new Error('manifest format invalid');
    }
    return json as CatalogManifest;
  } finally {
    clearTimeout(timeout);
  }
}

// 最新manifestを確認する。force=false の場合、前回チェックから24時間未満なら
// ネットワークアクセスをせずスキップする(自動チェック用)。手動チェックは force=true で呼ぶ。
export async function checkForCatalogUpdate(
  force = false
): Promise<{ available: boolean; manifest?: CatalogManifest }> {
  if (!force) {
    const lastChecked = await getSetting('catalog_update_last_checked_at');
    if (lastChecked && Date.now() - new Date(lastChecked).getTime() < CHECK_INTERVAL_MS) {
      return { available: false };
    }
  }
  const manifest = await fetchManifest();
  await setSetting('catalog_update_last_checked_at', new Date().toISOString());
  const applied = await getCatalogAppliedVersion();
  return { available: manifest.version > applied, manifest };
}

// ダウンロード→検証→適用を行う。いずれかの段階で失敗した場合は例外を投げ、
// 既存のカタログDBには一切変更を加えない(ダウンロード先の一時ファイルも必ず削除する)。
export async function downloadAndApplyCatalogUpdate(
  manifest: CatalogManifest,
  onProgress?: (stage: CatalogUpdateStage) => void
): Promise<void> {
  const dir = new Directory(Paths.cache, 'catalog-updates');
  dir.create({ intermediates: true, idempotent: true });

  onProgress?.('downloading');
  let downloaded: File;
  try {
    // ディレクトリを渡すと、実際のファイル名はレスポンスヘッダから決定される。
    // idempotent: true により、同名の既存ファイルがあっても上書きされる。
    // expo-file-systemの型定義の都合上、静的downloadFileAsyncの戻り値型が
    // インポートしたFileクラスと厳密には一致しないため明示キャストする。
    downloaded = (await File.downloadFileAsync(manifest.sqlite_url, dir, { idempotent: true })) as unknown as File;
  } catch {
    throw new Error('カタログのダウンロードに失敗しました');
  }

  try {
    onProgress?.('verifying');

    if (downloaded.size !== manifest.size_bytes) {
      throw new Error('ダウンロードしたファイルのサイズが一致しません');
    }
    const md5 = downloaded.md5 ?? downloaded.info({ md5: true }).md5;
    if (md5 !== manifest.md5) {
      throw new Error('ダウンロードしたファイルの検証に失敗しました');
    }

    const bytes = await downloaded.bytes();
    const remoteDb = await SQLite.deserializeDatabaseAsync(bytes);
    let rows: SeedRow[];
    try {
      const versionRow = await remoteDb.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      if ((versionRow?.user_version ?? -1) !== manifest.version) {
        throw new Error('ダウンロードしたファイルのバージョンが一致しません');
      }
      const hasTable = await remoteDb.getFirstAsync(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='catalog_paints'"
      );
      if (!hasTable) {
        throw new Error('ダウンロードしたファイルの形式が不正です');
      }
      rows = await remoteDb.getAllAsync<SeedRow>(
        'SELECT brand, series, series_en, code, name_ja, name_en, hex,' +
        ' rgb_r, rgb_g, rgb_b, lab_l, lab_a, lab_b, barcode, gloss, paint_type' +
        ' FROM catalog_paints'
      );
      if (rows.length < MIN_EXPECTED_ROWS || Math.abs(rows.length - manifest.row_count) > manifest.row_count * 0.1) {
        throw new Error('ダウンロードしたファイルの内容が想定と異なります');
      }
    } finally {
      await remoteDb.closeAsync();
    }

    onProgress?.('applying');
    await applyCatalogUpdate(rows, manifest.version);
  } finally {
    if (downloaded.exists) downloaded.delete();
  }
}
