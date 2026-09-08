import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as path;

class GoogleDriveService {
  // ----------------------------------------------------------------
  // NEW Google Sheet ID (itemmast.xlsx)
  // https://docs.google.com/spreadsheets/d/19_NvyTz8QQ0Sp25lh3CF6lUeEA0NZrvJ
  // ----------------------------------------------------------------
  static const String sheetId =
      '19_NvyTz8QQ0Sp25lh3CF6lUeEA0NZrvJ';

  static Uri get _exportUrl => Uri.parse(
        'https://docs.google.com/spreadsheets/d/'
        '$sheetId/export?format=xlsx',
      );

  // ------------------------------------------------------------------
  // VERSION CHECK
  //
  // Downloads the Google Sheet export and computes an MD5 hash of
  // the raw bytes.  The hash only changes when the file content
  // changes — it is NOT affected by HTTP Date / request-time headers
  // that used to cause a re-download on every app restart.
  //
  // The downloaded bytes are returned alongside the hash so that the
  // caller can reuse them without a second HTTP request.
  // ------------------------------------------------------------------

  /// Downloads the xlsx export and returns:
  ///   - [version]: MD5 hex string of the file bytes
  ///   - [bytes]:   the raw file bytes (reuse to avoid a second download)
  Future<({String version, List<int> bytes})>
      downloadAndHash() async {
    final response = await http.get(_exportUrl);

    if (response.statusCode != 200) {
      throw Exception(
        'Could not fetch remote spreadsheet. '
        'HTTP ${response.statusCode}',
      );
    }

    if (response.bodyBytes.isEmpty) {
      throw Exception(
        'Remote spreadsheet returned empty body.',
      );
    }

    final digest =
        md5.convert(response.bodyBytes);
    final version = digest.toString();

    return (
      version: version,
      bytes: response.bodyBytes,
    );
  }

  // ------------------------------------------------------------------
  // DOWNLOAD EXCEL
  // Saves already-downloaded bytes to a temporary file.
  // ------------------------------------------------------------------

  /// Writes [bytes] (previously downloaded) to a temp file and returns it.
  Future<File> saveBytesToFile(
    List<int> bytes,
    Directory directory,
  ) async {
    if (bytes.length < 1000) {
      throw Exception(
        'Downloaded Excel file appears to be invalid '
        '(too small: ${bytes.length} bytes).',
      );
    }

    final temporaryPath = path.join(
      directory.path,
      'itemmast.xlsx.download',
    );

    final temporaryFile = File(temporaryPath);

    if (await temporaryFile.exists()) {
      await temporaryFile.delete();
    }

    await temporaryFile.writeAsBytes(
      bytes,
      flush: true,
    );

    return temporaryFile;
  }

  /// Computes the MD5 hash of an already-saved [file] on disk.
  /// Used by [syncDatabase] to record the version after a manual sync.
  Future<String> hashFile(File file) async {
    final bytes = await file.readAsBytes();
    final digest = md5.convert(bytes);
    return digest.toString();
  }

  /// Downloads the Google Sheet as .xlsx into a temporary file.
  /// Prefer using [downloadAndHash] + [saveBytesToFile] together so
  /// that you get the content hash without a second HTTP round-trip.
  Future<File> downloadExcel(
    Directory directory,
  ) async {
    final response = await http.get(_exportUrl);

    if (response.statusCode != 200) {
      throw Exception(
        'Excel download failed. '
        'HTTP ${response.statusCode}',
      );
    }

    if (response.bodyBytes.isEmpty) {
      throw Exception(
        'Downloaded Excel file is empty.',
      );
    }

    return saveBytesToFile(
      response.bodyBytes,
      directory,
    );
  }

  // ------------------------------------------------------------------
  // LEGACY – kept so existing call-sites don't break
  // ------------------------------------------------------------------

  Future<File> downloadDatabase(
    Directory directory,
  ) async {
    throw UnimplementedError(
      'downloadDatabase() is no longer used. '
      'Use downloadExcel() instead.',
    );
  }
}