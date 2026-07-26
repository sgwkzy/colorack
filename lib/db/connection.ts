import * as SQLite from 'expo-sqlite';

let _db: SQLite.SQLiteDatabase | null = null;

export function getDB(): SQLite.SQLiteDatabase {
  if (!_db) throw new Error('DB not initialized. Call initDB() first.');
  return _db;
}

export function _setDB(db: SQLite.SQLiteDatabase): void {
  _db = db;
}
