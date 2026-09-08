import 'dart:io';

import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

class DatabaseService {
  static Database? _database;

  Future<Database> get database async {
    if (_database != null) {
      return _database!;
    }

    _database = await _openDatabase();

    return _database!;
  }

  Future<Database> _openDatabase() async {
    final databasesPath = await getDatabasesPath();

    final databasePath = join(
      databasesPath,
      'item_scanner.db',
    );

    // Open (or create) the database.
    // If the file does not exist sqflite creates a new one.
    // onCreate creates the items table so getItemCount() can
    // safely run even before the first Google Drive sync.
    final db = await openDatabase(
      databasePath,
      version: 2,
      onCreate: (db, version) async {
        // Fresh install -- no bundled asset database.
        // Create an empty schema.  checkForDatabaseUpdate()
        // will detect that local version == null and download
        // the latest XLSX from Google Drive automatically.
        await db.execute('''
          CREATE TABLE IF NOT EXISTS items (
            I_CODE    TEXT PRIMARY KEY,
            ITEM_NAME TEXT,
            DESCRIBE  TEXT,
            QUANTITY  TEXT,
            RATE      TEXT,
            DISC_PER  TEXT,
            DISC_B    TEXT
          )
        ''');
        await db.execute('''
          CREATE TABLE IF NOT EXISTS items_staging (
            I_CODE    TEXT PRIMARY KEY,
            ITEM_NAME TEXT,
            DESCRIBE  TEXT,
            QUANTITY  TEXT,
            RATE      TEXT,
            DISC_PER  TEXT,
            DISC_B    TEXT
          )
        ''');
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) {
          try {
            await db.execute('ALTER TABLE items ADD COLUMN DISC_B TEXT');
          } catch (_) {}
        }
      },
    );

    // Defensive check: ensure DISC_B column exists in case of unversioned/copied DB
    try {
      await db.execute('ALTER TABLE items ADD COLUMN DISC_B TEXT');
    } catch (_) {}

    // Defensive check: ensure items_staging table exists for Stage 7 atomic sync
    try {
      await db.execute('''
        CREATE TABLE IF NOT EXISTS items_staging (
          I_CODE    TEXT PRIMARY KEY,
          ITEM_NAME TEXT,
          DESCRIBE  TEXT,
          QUANTITY  TEXT,
          RATE      TEXT,
          DISC_PER  TEXT,
          DISC_B    TEXT
        )
      ''');
    } catch (_) {}

    // Make I_CODE searches extremely fast.
    // CREATE INDEX IF NOT EXISTS is safe to call every open.
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_items_icode '
      'ON items (I_CODE)',
    );

    return db;
  }

  // --------------------------------------------------
  // CALCULATE DISCOUNTED RATE: RATE * (100 - DISC_B) / 100
  // --------------------------------------------------

  static String calculateDiscountedRate(dynamic rawRate, dynamic rawDiscB) {
    if (rawRate == null) return '';
    final cleanedRate = rawRate
        .toString()
        .replaceAll('₹', '')
        .replaceAll('Rs.', '')
        .replaceAll('Rs', '')
        .replaceAll(',', '')
        .trim();
    if (cleanedRate.isEmpty) return '';
    final rate = double.tryParse(cleanedRate);
    if (rate == null) return rawRate.toString().trim();

    final cleanedDiscB = (rawDiscB?.toString() ?? '')
        .replaceAll('%', '')
        .replaceAll(',', '')
        .trim();
    final discB = double.tryParse(cleanedDiscB) ?? 0.0;

    final finalRate = rate * (100.0 - discB) / 100.0;
    final fixed2 = finalRate.toStringAsFixed(2);
    if (fixed2.endsWith('.00')) {
      return fixed2.substring(0, fixed2.length - 3);
    }
    return fixed2;
  }

  // --------------------------------------------------
  // FIND ITEM
  // --------------------------------------------------

  Future<Map<String, dynamic>?> findItem(
    String code,
  ) async {
    final db = await database;

    final result = await db.query(
      'items',
      where: 'I_CODE = ?',
      whereArgs: [code.trim()],
      limit: 1,
    );

    if (result.isEmpty) {
      return null;
    }

    return result.first;
  }

  // --------------------------------------------------
  // ITEM COUNT
  // --------------------------------------------------

  Future<int> getItemCount() async {
    final db = await database;

    final result = await db.rawQuery(
      'SELECT COUNT(*) AS count FROM items',
    );

    return Sqflite.firstIntValue(result) ?? 0;
  }

  // --------------------------------------------------
  // CLOSE DATABASE
  // --------------------------------------------------

  Future<void> closeDatabase() async {
    if (_database != null) {
      await _database!.close();
      _database = null;
    }
  }

  // --------------------------------------------------
  // STAGING & ATOMIC CATALOG REPLACEMENT (STAGE 7)
  // --------------------------------------------------

  /// Empties the items_staging table before downloading a fresh cloud catalog.
  Future<void> clearStaging() async {
    final db = await database;
    await db.execute('DELETE FROM items_staging');
  }

  /// Inserts a chunk of records into items_staging using a batch transaction.
  Future<void> insertStagingBatch(List<Map<String, dynamic>> rows) async {
    if (rows.isEmpty) return;
    final db = await database;
    final batch = db.batch();
    for (final row in rows) {
      batch.insert(
        'items_staging',
        row,
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }
    await batch.commit(noResult: true);
  }

  /// Counts the total records currently staged in items_staging.
  Future<int> getStagingCount() async {
    final db = await database;
    final result = await db.rawQuery('SELECT COUNT(*) AS count FROM items_staging');
    return Sqflite.firstIntValue(result) ?? 0;
  }

  /// Atomically replaces the active `items` catalog with the validated records
  /// from `items_staging` inside a single SQLite transaction.
  /// If ANY error occurs, SQLite rolls back completely, preserving the active catalog.
  Future<int> atomicallyPublishStaging() async {
    final db = await database;
    return await db.transaction<int>((txn) async {
      await txn.execute('DELETE FROM items');
      await txn.execute('INSERT INTO items SELECT * FROM items_staging');
      await txn.execute('DELETE FROM items_staging');
      final result = await txn.rawQuery('SELECT COUNT(*) AS count FROM items');
      return Sqflite.firstIntValue(result) ?? 0;
    });
  }

  /// Cleans up items_staging if a download or validation fails midway.
  Future<void> cleanUpStaging() async {
    try {
      final db = await database;
      await db.execute('DELETE FROM items_staging');
    } catch (_) {}
  }

  // --------------------------------------------------
  // REPLACE DATABASE
  // --------------------------------------------------

  Future<int> replaceDatabase(
    File newDatabase,
  ) async {
    final databasesPath =
        await getDatabasesPath();

    final databasePath = join(
      databasesPath,
      'item_scanner.db',
    );

    // Check downloaded file.
    if (!await newDatabase.exists()) {
      throw Exception(
        'Downloaded database does not exist.',
      );
    }

    final fileSize =
        await newDatabase.length();

    if (fileSize < 1000) {
      throw Exception(
        'Downloaded database appears to be invalid.',
      );
    }

    // Close current database.
    await closeDatabase();

    final currentDatabase =
        File(databasePath);

    // Create backup.
    final backupPath =
        '$databasePath.backup';

    final backupFile =
        File(backupPath);

    if (await currentDatabase.exists()) {
      await currentDatabase.copy(
        backupPath,
      );
    }

    try {
      // Replace database.
      await newDatabase.copy(
        databasePath,
      );

      // Delete temporary download.
      if (await newDatabase.exists()) {
        await newDatabase.delete();
      }

      // Open and verify new database.
      _database =
          await _openDatabase();

      final count =
          await getItemCount();

      // Backup no longer needed.
      if (await backupFile.exists()) {
        await backupFile.delete();
      }

      return count;
    } catch (e) {
      // Restore previous database.
      if (await backupFile.exists()) {
        await backupFile.copy(
          databasePath,
        );
      }

      _database = null;

      throw Exception(
        'Database replacement failed: $e',
      );
    }
  }
}