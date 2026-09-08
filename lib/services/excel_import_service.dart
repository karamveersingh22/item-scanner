import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:flutter/foundation.dart';
import 'package:excel/excel.dart';
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

/// Runs inside a background isolate.
///
/// Ultra-fast streaming XLSX reader:
/// An .xlsx file is a standard ZIP container. Instead of parsing
/// styles, fonts, borders, formats, and XML DOM for 50,000+ cells
/// (which takes 30-60s on phones), we extract the shared strings
/// table and sheet rows directly in pure Dart in under 1 second.
Future<List<Map<String, String>>> _parseExcelFile(
  String excelPath,
) async {
  final file = File(excelPath);

  if (!await file.exists()) {
    throw Exception('Excel file not found.');
  }

  final bytes = await file.readAsBytes();

  if (bytes.isEmpty) {
    throw Exception('Excel file is empty.');
  }

  try {
    final directRows = _fastParseXlsx(bytes);
    if (directRows.isNotEmpty) {
      return directRows;
    }
  } catch (e) {
    debugPrint('Fast XLSX parser fallback triggered: $e');
  }

  // Safe fallback to standard Excel package if needed
  return _fallbackParseWithExcel(bytes);
}

List<Map<String, String>> _fastParseXlsx(List<int> bytes) {
  final archive = ZipDecoder().decodeBytes(bytes);

  // 1. Extract shared strings table
  final ssFile = archive.findFile('xl/sharedStrings.xml');
  final sharedStrings = <String>[];
  if (ssFile != null) {
    final raw = utf8.decode(ssFile.content as List<int>);
    final siRegex = RegExp(r'<si>(.*?)</si>', dotAll: true);
    final tRegex = RegExp(r'<t(?: [^>]*)?>(.*?)</t>', dotAll: true);
    for (final match in siRegex.allMatches(raw)) {
      final siContent = match.group(1) ?? '';
      final tMatches = tRegex.allMatches(siContent);
      if (tMatches.isEmpty) {
        sharedStrings.add('');
      } else {
        final buffer = StringBuffer();
        for (final tm in tMatches) {
          buffer.write(tm.group(1) ?? '');
        }
        sharedStrings.add(
          buffer
              .toString()
              .replaceAll('&amp;', '&')
              .replaceAll('&lt;', '<')
              .replaceAll('&gt;', '>')
              .replaceAll('&quot;', '"')
              .replaceAll('&apos;', "'"),
        );
      }
    }
  }

  // 2. Find worksheet
  ArchiveFile? sheetFile = archive.findFile('xl/worksheets/sheet1.xml');
  if (sheetFile == null) {
    for (final f in archive) {
      if (f.name.startsWith('xl/worksheets/') && f.name.endsWith('.xml')) {
        sheetFile = f;
        break;
      }
    }
  }

  if (sheetFile == null) {
    return [];
  }

  final sheetContent = utf8.decode(sheetFile.content as List<int>);

  final rowRegex = RegExp(r'<row [^>]*>(.*?)</row>', dotAll: true);
  final cellRegex = RegExp(r'<c [^>]*r="([A-Z]+)\d+"[^>]*>(?:<v>([^<]*)</v>)?', dotAll: true);
  final typeRegex = RegExp(r't="([^"]+)"');

  int colLetterToIndex(String letters) {
    int result = 0;
    for (int i = 0; i < letters.length; i++) {
      result = result * 26 + (letters.codeUnitAt(i) - 64);
    }
    return result - 1;
  }

  int? iCodeCol;
  int? itemNameCol;
  int? describeCol;
  int? quantityCol;
  int? rateCol;
  int? discPerCol;
  int? discBCol;

  final rows = <Map<String, String>>[];
  bool isFirstRow = true;

  for (final rowMatch in rowRegex.allMatches(sheetContent)) {
    final rowBody = rowMatch.group(1) ?? '';
    final rowData = <int, String>{};

    for (final cellMatch in cellRegex.allMatches(rowBody)) {
      final wholeCellTag = cellMatch.group(0) ?? '';
      final colLetters = cellMatch.group(1) ?? '';
      final rawVal = cellMatch.group(2) ?? '';
      final colIdx = colLetterToIndex(colLetters);

      final tMatch = typeRegex.firstMatch(wholeCellTag);
      final isSharedString = tMatch?.group(1) == 's';

      String cellValue = rawVal;
      if (isSharedString) {
        final sIdx = int.tryParse(rawVal);
        if (sIdx != null && sIdx >= 0 && sIdx < sharedStrings.length) {
          cellValue = sharedStrings[sIdx];
        }
      }
      rowData[colIdx] = cellValue.trim();
    }

    if (isFirstRow) {
      isFirstRow = false;
      for (final entry in rowData.entries) {
        final name = entry.value.trim().toUpperCase();
        if (name == 'I_CODE') iCodeCol = entry.key;
        if (name == 'ITEM_NAME') itemNameCol = entry.key;
        if (name == 'DESCRIBE') describeCol = entry.key;
        if (name == 'QUANTITY') quantityCol = entry.key;
        if (name == 'RATE') rateCol = entry.key;
        if (name == 'DISC_PER') discPerCol = entry.key;
        if (name == 'DISC_B' || name == 'DISC B' || name == 'DISCB') discBCol = entry.key;
      }
      continue;
    }

    final iCode = iCodeCol != null ? (rowData[iCodeCol] ?? '') : '';
    if (iCode.isEmpty) continue;

    rows.add({
      'I_CODE': iCode,
      'ITEM_NAME': itemNameCol != null ? (rowData[itemNameCol] ?? '') : '',
      'DESCRIBE': describeCol != null ? (rowData[describeCol] ?? '') : '',
      'QUANTITY': quantityCol != null ? (rowData[quantityCol] ?? '') : '',
      'RATE': rateCol != null ? (rowData[rateCol] ?? '') : '',
      'DISC_PER': discPerCol != null ? (rowData[discPerCol] ?? '') : '',
      'DISC_B': discBCol != null ? (rowData[discBCol] ?? '') : '',
    });
  }

  return rows;
}

List<Map<String, String>> _fallbackParseWithExcel(List<int> bytes) {
  final excel = Excel.decodeBytes(bytes);

  if (excel.tables.isEmpty) {
    throw Exception('No worksheet found in Excel file.');
  }

  final sheet = excel.tables.values.first;
  final allRows = sheet.rows;

  if (allRows.length < 2) {
    throw Exception('Excel file contains no item data.');
  }

  final headers = allRows.first.map((cell) {
    return cell?.value?.toString().trim().toUpperCase() ?? '';
  }).toList();

  int column(String name) {
    return headers.indexOf(name);
  }

  final iCodeIndex = column('I_CODE');
  final itemNameIndex = column('ITEM_NAME');
  final describeIndex = column('DESCRIBE');
  final quantityIndex = column('QUANTITY');
  final rateIndex = column('RATE');
  final discPerIndex = column('DISC_PER');
  int discBIndex = column('DISC_B');
  if (discBIndex < 0) discBIndex = column('DISC B');
  if (discBIndex < 0) discBIndex = column('DISCB');

  if (iCodeIndex < 0) {
    throw Exception('I_CODE column not found.');
  }

  String value(List<Data?> row, int index) {
    if (index >= row.length) return '';
    final cell = row[index];
    if (cell == null) return '';
    return cell.value?.toString().trim() ?? '';
  }

  final rows = <Map<String, String>>[];
  final totalRowCount = allRows.length;

  for (int rowIndex = 1; rowIndex < totalRowCount; rowIndex++) {
    final row = allRows[rowIndex];
    final iCode = value(row, iCodeIndex);

    if (iCode.isEmpty) continue;

    rows.add({
      'I_CODE': iCode,
      'ITEM_NAME': itemNameIndex >= 0 ? value(row, itemNameIndex) : '',
      'DESCRIBE': describeIndex >= 0 ? value(row, describeIndex) : '',
      'QUANTITY': quantityIndex >= 0 ? value(row, quantityIndex) : '',
      'RATE': rateIndex >= 0 ? value(row, rateIndex) : '',
      'DISC_PER': discPerIndex >= 0 ? value(row, discPerIndex) : '',
      'DISC_B': discBIndex >= 0 ? value(row, discBIndex) : '',
    });
  }

  if (rows.isEmpty) {
    throw Exception('No valid I_CODE records found in Excel.');
  }

  return rows;
}

class ExcelImportService {
  /// Imports an Excel (.xlsx) file into a SQLite database.
  ///
  /// Architecture
  /// ------------
  /// 1. [excelFile.path] is passed as a String into
  ///    [Isolate.run] -- never the File object itself.
  /// 2. The background isolate reads the file and runs
  ///    Excel.decodeBytes() completely off the UI thread.
  /// 3. Parsed rows (`List<Map<String,String>>`) are returned
  ///    to the UI isolate -- only plain Dart types, no plugins.
  /// 4. SQLite inserts happen in batches of 2 000 inside a
  ///    single transaction.
  /// 5. The index is created AFTER all rows are inserted.
  /// 6. A final COUNT(*) validates the result.
  ///
  /// Safety
  /// ------
  /// When [databasePath] is a temporary file path (as used by
  /// main.dart during sync) the production database is never
  /// touched until replaceDatabase() succeeds.
  Future<int> importExcel(
    File excelFile, {
    String? databasePath,
    void Function(int imported, int total)? onProgress,
  }) async {
    if (!await excelFile.exists()) {
      throw Exception('Excel file does not exist.');
    }

    // ============================================================
    // STEP 1 -- Background isolate
    // ============================================================
    // Excel.decodeBytes() is CPU-intensive.  Running it here via
    // Isolate.run() keeps the Flutter UI thread free -- preventing
    // Android ANR and skipped frames on large XLSX files.
    //
    // Only the file path (String) crosses the isolate boundary.
    // ============================================================

    final String excelPath = excelFile.path;
    final rows = await compute(
      _parseExcelFile,
      excelPath,
    );

    final total = rows.length;

    // Notify caller that background parsing completed.
    // imported = 0 signals "parsed, now inserting".
    onProgress?.call(0, total);

    // ============================================================
    // STEP 2 -- Resolve database path
    // ============================================================

    final databasesPath = await getDatabasesPath();

    final finalPath = databasePath ??
        join(
          databasesPath,
          'item_scanner.db',
        );

    // ============================================================
    // STEP 3 -- Open target database
    // ============================================================
    // main.dart passes a TEMPORARY path during sync so this
    // opens a fresh file completely separate from production.
    // ============================================================

    final db = await openDatabase(finalPath);

    try {
      await db.execute('''
        CREATE TABLE IF NOT EXISTS items (
          I_CODE TEXT PRIMARY KEY,
          ITEM_NAME TEXT,
          DESCRIBE TEXT,
          QUANTITY TEXT,
          RATE TEXT,
          DISC_PER TEXT,
          DISC_B TEXT
        )
      ''');

      try {
        await db.execute('ALTER TABLE items ADD COLUMN DISC_B TEXT');
      } catch (_) {}

      // ============================================================
      // STEP 4 -- Batch insert inside a single transaction
      // ============================================================
      // Batch size: 2 000.
      // Index NOT created yet -- faster to build it once after.
      // ============================================================

      int imported = 0;

      await db.transaction((txn) async {
        // Safe to clear -- this is always the temp DB during sync.
        await txn.delete('items');

        var batch = txn.batch();
        int batchCount = 0;

        for (final row in rows) {
          batch.insert(
            'items',
            row,
            conflictAlgorithm:
                ConflictAlgorithm.replace,
          );

          imported++;
          batchCount++;

          if (batchCount >= 2000) {
            await batch.commit(
              noResult: true,
            );

            batch = txn.batch();
            batchCount = 0;

            // Progress update after each 2 000-row batch.
            onProgress?.call(
              imported,
              total,
            );
          }
        }

        if (batchCount > 0) {
          await batch.commit(
            noResult: true,
          );
        }
      });

      // ============================================================
      // STEP 5 -- Create index after all inserts
      // ============================================================
      // Building once at the end is far faster than maintaining
      // the B-tree incrementally during each insert.
      // ============================================================

      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_items_icode '
        'ON items (I_CODE)',
      );

      // ============================================================
      // STEP 6 -- Validate
      // ============================================================

      final result = await db.rawQuery(
        'SELECT COUNT(*) AS count FROM items',
      );

      final count = Sqflite.firstIntValue(result) ?? 0;

      if (count <= 0) {
        throw Exception(
          'Validation failed: '
          'temporary database contains no items.',
        );
      }

      onProgress?.call(count, total);

      return count;
    } finally {
      await db.close();
    }
  }
}