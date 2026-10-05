/// The on-device SQLite database. Days get a row each (a single edit writes one row, not the whole history);
/// everything else is a small JSON document keyed by name.
library;

import 'dart:convert';

import 'package:sqlite3/sqlite3.dart';

class LocalDatabase {
  LocalDatabase._(this.db) {
    _migrate();
  }

  /// A throwaway in-memory database (tests).
  factory LocalDatabase.inMemory() => LocalDatabase._(sqlite3.openInMemory());

  /// The database file at [path], created if missing.
  factory LocalDatabase.open(String path) => LocalDatabase._(sqlite3.open(path));

  /// Bump together with a new step in [_migrate]. An older app opening a newer database refuses instead of
  /// guessing, so a downgrade cannot corrupt data.
  static const schemaVersion = 1;

  final Database db;

  void _migrate() {
    final current = db.userVersion;
    if (current > schemaVersion) {
      db.close();
      throw StateError('Database schema v$current is newer than this app supports (v$schemaVersion).');
    }
    if (current < 1) {
      transaction(() {
        db.execute('''
          CREATE TABLE days (date TEXT PRIMARY KEY, json TEXT NOT NULL) WITHOUT ROWID;
          CREATE TABLE tombstones (date TEXT PRIMARY KEY, hash TEXT NOT NULL) WITHOUT ROWID;
          CREATE TABLE docs (key TEXT PRIMARY KEY, json TEXT NOT NULL) WITHOUT ROWID;
          CREATE TABLE restore_points (position INTEGER PRIMARY KEY, json TEXT NOT NULL);
        ''');
        db.userVersion = 1;
      });
    }
  }

  /// Runs [body] atomically: every statement lands, or none does.
  T transaction<T>(T Function() body) {
    db.execute('BEGIN');
    try {
      final result = body();
      db.execute('COMMIT');
      return result;
    } catch (_) {
      db.execute('ROLLBACK');
      rethrow;
    }
  }

  /// The decoded JSON document stored under [key]; null when absent or unreadable.
  Object? readDoc(String key) {
    final rows = db.select('SELECT json FROM docs WHERE key = ?', [key]);
    if (rows.isEmpty) return null;
    try {
      return jsonDecode(rows.first['json'] as String);
    } on FormatException {
      return null;
    }
  }

  void writeDoc(String key, Object? value) =>
      db.execute('INSERT OR REPLACE INTO docs (key, json) VALUES (?, ?)', [key, jsonEncode(value)]);

  void deleteDoc(String key) => db.execute('DELETE FROM docs WHERE key = ?', [key]);

  void close() => db.close();
}
