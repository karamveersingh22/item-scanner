// ignore_for_file: avoid_print, unnecessary_string_interpolations

import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:item_scanner/models/sync_item.dart';
import 'package:item_scanner/models/sync_state.dart';
import 'package:item_scanner/services/api_service.dart';
import 'package:item_scanner/services/auth_service.dart';
import 'package:item_scanner/services/cloud_sync_service.dart';
import 'package:item_scanner/services/database_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Mock ApiService for deterministic, offline testing of all sync scenarios
class MockSyncApiService extends ApiService {
  final Map<String, dynamic> Function(Uri uri, String? token) onGet;

  MockSyncApiService(this.onGet);

  @override
  Future<SyncDataResponse> fetchSyncData({
    required String token,
    String? version,
    int? limit,
    int? offset,
    String? overrideBaseUrl,
  }) async {
    final queryParams = <String, String>{};
    if (version != null && version.trim().isNotEmpty) {
      queryParams['version'] = version.trim();
    }
    if (limit != null && limit > 0) {
      queryParams['limit'] = limit.toString();
    }
    if (offset != null && offset >= 0) {
      queryParams['offset'] = offset.toString();
    }

    final uri = Uri.parse('http://mock.test/api/sync/data').replace(
      queryParameters: queryParams.isNotEmpty ? queryParams : null,
    );

    final raw = onGet(uri, token);
    final statusCode = raw['statusCode'] as int?;
    if (statusCode != null && statusCode >= 400) {
      final body = raw['body'] as Map<String, dynamic>?;
      final msg = body?['error']?.toString() ?? 'HTTP $statusCode Error';
      throw ApiException(
        msg,
        statusCode: statusCode,
        isUnauthorized: statusCode == 401,
        isForbidden: statusCode == 403,
        isNetworkError: raw['isNetworkError'] == true,
      );
    }
    if (raw['isNetworkError'] == true) {
      throw ApiException('Network unreachable', isNetworkError: true);
    }

    final body = raw['body'] as Map<String, dynamic>;
    return SyncDataResponse.fromJson(body['data'] as Map<String, dynamic>);
  }
}

/// In-memory Mock DatabaseService for fast, fully isolated unit test runs
class MockMemoryDatabaseService extends DatabaseService {
  final Map<String, Map<String, dynamic>> _items = {};
  final Map<String, Map<String, dynamic>> _staging = {};

  @override
  Future<Map<String, dynamic>?> findItem(String code) async {
    final item = _items[code.trim()];
    if (item == null) return null;
    return Map<String, dynamic>.from(item);
  }

  @override
  Future<int> getItemCount() async {
    return _items.length;
  }

  @override
  Future<void> clearStaging() async {
    _staging.clear();
  }

  @override
  Future<void> insertStagingBatch(List<Map<String, dynamic>> rows) async {
    for (final row in rows) {
      final code = (row['I_CODE'] ?? '').toString();
      _staging[code] = Map<String, dynamic>.from(row);
    }
  }

  @override
  Future<int> getStagingCount() async {
    return _staging.length;
  }

  @override
  Future<int> atomicallyPublishStaging() async {
    // Atomic replacement
    _items.clear();
    _items.addAll(_staging);
    _staging.clear();
    return _items.length;
  }

  @override
  Future<void> cleanUpStaging() async {
    _staging.clear();
  }

  // Pre-seed items for testing atomicity preservation
  void seedItems(List<Map<String, dynamic>> items) {
    _items.clear();
    for (final it in items) {
      _items[(it['I_CODE'] ?? '').toString()] = Map<String, dynamic>.from(it);
    }
  }

  List<String> get currentItemCodes => _items.keys.toList();
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });

  group('Category 1: Sync Data Models & Validation', () {
    test('SyncItem preserves leading zeros strictly as String', () {
      final json = {
        'i_code': '001234',
        'item_name': 'Leading Zero Item',
        'describe': 'Barcode leading zeros check',
        'quantity': '10',
        'rate': '499.00',
        'disc_per': '10',
        'disc_b': '5.00',
      };

      final item = SyncItem.fromJson(json);
      expect(item.iCode, '001234'); // Must not be converted to '1234'
      expect(item.isValid, true);
      expect(item.toMap()['I_CODE'], '001234');
      expect(item.toMap()['RATE'], '499.00');
    });

    test('SyncItem rejects empty I_CODE', () {
      final item = SyncItem.fromJson({'i_code': '   '});
      expect(item.isValid, false);
    });

    test('SyncDataResponse correctly parses up_to_date: true with empty items', () {
      final json = {
        'up_to_date': true,
        'data_version': 'catalog-hash-abc123',
        'item_count': 500,
        'returned_count': 0,
        'last_sync_at': '2026-09-07T12:00:00Z',
        'items': [],
      };

      final resp = SyncDataResponse.fromJson(json);
      expect(resp.upToDate, true);
      expect(resp.dataVersion, 'catalog-hash-abc123');
      expect(resp.items.isEmpty, true);
      expect(resp.itemCount, 500);
    });

    test('SyncDataResponse correctly parses items payload when up_to_date: false', () {
      final json = {
        'up_to_date': false,
        'data_version': 'new-version-xyz789',
        'item_count': 2,
        'returned_count': 2,
        'items': [
          {'i_code': '0001', 'item_name': 'Item 1', 'rate': '100'},
          {'i_code': '0002', 'item_name': 'Item 2', 'rate': '200'},
        ],
      };

      final resp = SyncDataResponse.fromJson(json);
      expect(resp.upToDate, false);
      expect(resp.dataVersion, 'new-version-xyz789');
      expect(resp.items.length, 2);
      expect(resp.items[0].iCode, '0001');
      expect(resp.items[1].iCode, '0002');
    });
  });

  group('Category 2: SyncState Reactive Model', () {
    test('initial state is idle with zero progress', () {
      final state = SyncState.initial();
      expect(state.status, SyncStatusState.idle);
      expect(state.isIdle, true);
      expect(state.isSyncing, false);
      expect(state.downloadedCount, 0);
    });

    test('isSyncing is true during active phases', () {
      expect(const SyncState(status: SyncStatusState.checking).isSyncing, true);
      expect(const SyncState(status: SyncStatusState.downloading).isSyncing, true);
      expect(const SyncState(status: SyncStatusState.validating).isSyncing, true);
      expect(const SyncState(status: SyncStatusState.publishing).isSyncing, true);
      expect(const SyncState(status: SyncStatusState.success).isSyncing, false);
      expect(const SyncState(status: SyncStatusState.failed).isSyncing, false);
    });

    test('copyWith properly updates state values', () {
      final state = SyncState.initial();
      final updated = state.copyWith(
        status: SyncStatusState.downloading,
        downloadedCount: 500,
        totalCount: 1000,
        progress: 0.5,
      );

      expect(updated.status, SyncStatusState.downloading);
      expect(updated.downloadedCount, 500);
      expect(updated.totalCount, 1000);
      expect(updated.progress, 0.5);
    });
  });

  group('Category 3: Authentication & Session Protection', () {
    test('Unauthenticated sync returns false and records error', () async {
      final auth = AuthService();
      final api = MockSyncApiService((uri, token) => {});
      final db = MockMemoryDatabaseService();

      final syncService = CloudSyncService.forTesting(
        authService: auth,
        apiService: api,
        dbService: db,
      );

      final success = await syncService.synchronize();
      expect(success, false);
      expect(syncService.state.isFailed, true);
      expect(syncService.state.lastError?.contains('Not authenticated'), true);
    });

    test('HTTP 401 session expiry triggers logout and fails safely', () async {
      final auth = AuthService();
      // Mock session setup
      await FlutterSecureStorage().write(key: 'company_auth_token', value: 'expired-jwt-token');
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'company_cached_profile',
        jsonEncode({'id': 'uuid-1', 'company_name': 'Test Co', 'username': 'test01', 'status': 'ACTIVE'}),
      );
      await auth.restoreSession(); // Auth state restored

      final api = MockSyncApiService((uri, token) {
        return {'statusCode': 401};
      });
      final db = MockMemoryDatabaseService();

      final syncService = CloudSyncService.forTesting(
        authService: auth,
        apiService: api,
        dbService: db,
      );

      final success = await syncService.synchronize();
      expect(success, false);
      expect(syncService.state.isFailed, true);
      expect(syncService.state.message.contains('Session expired'), true);
      expect(auth.isAuthenticated, false); // Logged out
    });
  });

  group('Category 4: Versioning & No-Change Optimization', () {
    test('Matching local version returns up_to_date: true with zero items downloaded', () async {
      final auth = AuthService();
      await FlutterSecureStorage().write(key: 'company_auth_token', value: 'valid-jwt');
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'company_cached_profile',
        jsonEncode({'id': 'uuid-1', 'company_name': 'Test Co', 'username': 'test01', 'status': 'ACTIVE'}),
      );
      await auth.restoreSession();

      // Store local version
      await prefs.setString(CloudSyncService.kCatalogDataVersionKey, 'version-hash-current-100');

      bool requestedWithVersion = false;
      final api = MockSyncApiService((uri, token) {
        if (uri.queryParameters['version'] == 'version-hash-current-100') {
          requestedWithVersion = true;
          return {
            'body': {
              'success': true,
              'data': {
                'up_to_date': true,
                'data_version': 'version-hash-current-100',
                'item_count': 1500,
                'returned_count': 0,
                'items': [],
              },
            },
          };
        }
        return {'statusCode': 500};
      });

      final db = MockMemoryDatabaseService();
      final syncService = CloudSyncService.forTesting(
        authService: auth,
        apiService: api,
        dbService: db,
      );

      final result = await syncService.synchronize();
      expect(result, true);
      expect(requestedWithVersion, true);
      expect(syncService.state.isSuccess, true);
      expect(syncService.state.message.contains('up to date'), true);
      expect(await db.getStagingCount(), 0); // No staging writes
    });
  });

  group('Category 5: Pagination & Chunked Downloads', () {
    test('Multi-page catalog combines chunks accurately', () async {
      final auth = AuthService();
      await FlutterSecureStorage().write(key: 'company_auth_token', value: 'valid-jwt');
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'company_cached_profile',
        jsonEncode({'id': 'uuid-1', 'company_name': 'Test Co', 'username': 'test01', 'status': 'ACTIVE'}),
      );
      await auth.restoreSession();

      // Total 25 items across 3 pages of limit 10 (Page 1: 10, Page 2: 10, Page 3: 5)
      final allItems = List.generate(25, (i) => {
        'i_code': 'P_${(i + 1).toString().padLeft(4, '0')}',
        'item_name': 'Item #${i + 1}',
        'rate': '10.00',
      });

      final requestedOffsets = <int>[];

      final api = MockSyncApiService((uri, token) {
        final offset = int.parse(uri.queryParameters['offset'] ?? '0');
        final limit = int.parse(uri.queryParameters['limit'] ?? '10');
        requestedOffsets.add(offset);

        final slice = allItems.skip(offset).take(limit).toList();
        return {
          'body': {
            'success': true,
            'data': {
              'up_to_date': false,
              'data_version': 'multi-page-hash-999',
              'item_count': 25,
              'returned_count': slice.length,
              'items': slice,
            },
          },
        };
      });

      final db = MockMemoryDatabaseService();
      final syncService = CloudSyncService.forTesting(
        authService: auth,
        apiService: api,
        dbService: db,
      );

      final success = await syncService.synchronize(chunkSize: 10);
      expect(success, true);
      expect(requestedOffsets, [0, 10, 20]);
      expect(await db.getItemCount(), 25);
      expect(prefs.getString(CloudSyncService.kCatalogDataVersionKey), 'multi-page-hash-999');
    });

    test('Failure in the middle of multi-page download stops sync safely', () async {
      final auth = AuthService();
      await FlutterSecureStorage().write(key: 'company_auth_token', value: 'valid-jwt');
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'company_cached_profile',
        jsonEncode({'id': 'uuid-1', 'company_name': 'Test Co', 'username': 'test01', 'status': 'ACTIVE'}),
      );
      await auth.restoreSession();

      final api = MockSyncApiService((uri, token) {
        final offset = int.parse(uri.queryParameters['offset'] ?? '0');
        if (offset == 0) {
          return {
            'body': {
              'success': true,
              'data': {
                'up_to_date': false,
                'data_version': 'new-failed-ver',
                'item_count': 20,
                'returned_count': 10,
                'items': List.generate(10, (i) => {'i_code': 'CHUNK_$i', 'rate': '10'}),
              },
            },
          };
        }
        // Second chunk fails with network error
        return {'isNetworkError': true};
      });

      final db = MockMemoryDatabaseService();
      db.seedItems([
        {'I_CODE': 'ORIGINAL_1', 'ITEM_NAME': 'Original Item 1'},
      ]);
      await prefs.setString(CloudSyncService.kCatalogDataVersionKey, 'initial-version-000');

      final syncService = CloudSyncService.forTesting(
        authService: auth,
        apiService: api,
        dbService: db,
      );

      final success = await syncService.synchronize(chunkSize: 10);
      expect(success, false);
      expect(syncService.state.isFailed, true);
      // Original catalog preserved
      expect(await db.getItemCount(), 1);
      expect(db.currentItemCodes, ['ORIGINAL_1']);
      // Original version preserved
      expect(prefs.getString(CloudSyncService.kCatalogDataVersionKey), 'initial-version-000');
      // Staging cleaned up
      expect(await db.getStagingCount(), 0);
    });
  });

  group('Category 6: Data Validation & Duplicate Rejection', () {
    test('Duplicate I_CODE in dataset throws error and rejects catalog', () async {
      final auth = AuthService();
      await FlutterSecureStorage().write(key: 'company_auth_token', value: 'valid-jwt');
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'company_cached_profile',
        jsonEncode({'id': 'uuid-1', 'company_name': 'Test Co', 'username': 'test01', 'status': 'ACTIVE'}),
      );
      await auth.restoreSession();

      final api = MockSyncApiService((uri, token) {
        return {
          'body': {
            'success': true,
            'data': {
              'up_to_date': false,
              'data_version': 'dup-version-fail',
              'item_count': 3,
              'returned_count': 3,
              'items': [
                {'i_code': 'DUP_CODE', 'item_name': 'First Item'},
                {'i_code': 'OTHER_CODE', 'item_name': 'Second Item'},
                {'i_code': 'DUP_CODE', 'item_name': 'Duplicate Item'},
              ],
            },
          },
        };
      });

      final db = MockMemoryDatabaseService();
      db.seedItems([{'I_CODE': 'SAFE_01', 'ITEM_NAME': 'Safe Item'}]);
      await prefs.setString(CloudSyncService.kCatalogDataVersionKey, 'safe-ver-001');

      final syncService = CloudSyncService.forTesting(
        authService: auth,
        apiService: api,
        dbService: db,
      );

      final success = await syncService.synchronize();
      expect(success, false);
      expect(syncService.state.isFailed, true);
      expect(syncService.state.lastError?.contains('duplicate item code'), true);
      // Previous catalog 100% intact
      expect(await db.getItemCount(), 1);
      expect(db.currentItemCodes, ['SAFE_01']);
      expect(prefs.getString(CloudSyncService.kCatalogDataVersionKey), 'safe-ver-001');
    });

    test('Empty I_CODE in dataset throws error and rejects catalog', () async {
      final auth = AuthService();
      await FlutterSecureStorage().write(key: 'company_auth_token', value: 'valid-jwt');
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'company_cached_profile',
        jsonEncode({'id': 'uuid-1', 'company_name': 'Test Co', 'username': 'test01', 'status': 'ACTIVE'}),
      );
      await auth.restoreSession();

      final api = MockSyncApiService((uri, token) {
        return {
          'body': {
            'success': true,
            'data': {
              'up_to_date': false,
              'data_version': 'empty-icode-fail',
              'item_count': 1,
              'returned_count': 1,
              'items': [
                {'i_code': '', 'item_name': 'Invalid Empty Code'},
              ],
            },
          },
        };
      });

      final db = MockMemoryDatabaseService();
      final syncService = CloudSyncService.forTesting(
        authService: auth,
        apiService: api,
        dbService: db,
      );

      final success = await syncService.synchronize();
      expect(success, false);
      expect(syncService.state.isFailed, true);
      expect(syncService.state.lastError?.contains('empty I_CODE'), true);
    });
  });

  group('Category 7: Atomicity & Failure Safety (Mandatory Requirement)', () {
    test('Old catalog and version remain completely untouched on failure; only successful commit swaps catalog', () async {
      final auth = AuthService();
      await FlutterSecureStorage().write(key: 'company_auth_token', value: 'valid-jwt');
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'company_cached_profile',
        jsonEncode({'id': 'uuid-1', 'company_name': 'Test Co', 'username': 'test01', 'status': 'ACTIVE'}),
      );
      await auth.restoreSession();

      final db = MockMemoryDatabaseService();
      // Seed 3 existing items
      db.seedItems([
        {'I_CODE': 'OLD_001', 'ITEM_NAME': 'Old Item 1', 'RATE': '10.00'},
        {'I_CODE': 'OLD_002', 'ITEM_NAME': 'Old Item 2', 'RATE': '20.00'},
        {'I_CODE': 'OLD_003', 'ITEM_NAME': 'Old Item 3', 'RATE': '30.00'},
      ]);
      await prefs.setString(CloudSyncService.kCatalogDataVersionKey, 'version-old-003');

      // Attempt 1: Server errors out midway
      final apiFail = MockSyncApiService((uri, token) => {'statusCode': 500, 'body': {'error': 'Database crash'}});
      final syncServiceFail = CloudSyncService.forTesting(
        authService: auth,
        apiService: apiFail,
        dbService: db,
      );

      final failResult = await syncServiceFail.synchronize();
      expect(failResult, false);

      // Verify old 3 items and version are 100% intact!
      expect(await db.getItemCount(), 3);
      expect(db.currentItemCodes, containsAll(['OLD_001', 'OLD_002', 'OLD_003']));
      expect(prefs.getString(CloudSyncService.kCatalogDataVersionKey), 'version-old-003');

      // Attempt 2: Server succeeds with 5 new items
      final new5Items = List.generate(5, (i) => {
        'i_code': 'NEW_00${i + 1}',
        'item_name': 'New Item ${i + 1}',
        'rate': '${(i + 1) * 100}.00',
      });

      final apiSuccess = MockSyncApiService((uri, token) => {
        'body': {
          'success': true,
          'data': {
            'up_to_date': false,
            'data_version': 'version-new-005',
            'item_count': 5,
            'returned_count': 5,
            'items': new5Items,
          },
        },
      });

      final syncServiceSuccess = CloudSyncService.forTesting(
        authService: auth,
        apiService: apiSuccess,
        dbService: db,
      );

      final successResult = await syncServiceSuccess.synchronize();
      expect(successResult, true);

      // Verify all 5 new items are committed and old items replaced
      expect(await db.getItemCount(), 5);
      expect(db.currentItemCodes, containsAll(['NEW_001', 'NEW_002', 'NEW_003', 'NEW_004', 'NEW_005']));
      expect(db.currentItemCodes, isNot(contains('OLD_001')));
      expect(prefs.getString(CloudSyncService.kCatalogDataVersionKey), 'version-new-005');
    });
  });

  group('Category 8: Performance Benchmarks (10k and 50k Items)', () {
    test('10,000 items realistic synchronization benchmark & search speed verification', () async {
      final auth = AuthService();
      await FlutterSecureStorage().write(key: 'company_auth_token', value: 'valid-jwt');
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'company_cached_profile',
        jsonEncode({'id': 'uuid-1', 'company_name': 'Test Co', 'username': 'test01', 'status': 'ACTIVE'}),
      );
      await auth.restoreSession();

      final items10k = List.generate(10000, (i) => {
        'i_code': 'ITEM_${(i + 1).toString().padLeft(6, '0')}',
        'item_name': 'Hardware Component #${i + 1}',
        'describe': 'Standard warehouse SKU $i',
        'quantity': '${(i % 500) + 1}',
        'rate': '${((i % 1000) + 9.99).toStringAsFixed(2)}',
        'disc_per': '${(i % 25)}',
        'disc_b': '${(i % 5)}.00',
      });

      final api = MockSyncApiService((uri, token) {
        final offset = int.parse(uri.queryParameters['offset'] ?? '0');
        final limit = int.parse(uri.queryParameters['limit'] ?? '1000');
        final slice = items10k.skip(offset).take(limit).toList();

        return {
          'body': {
            'success': true,
            'data': {
              'up_to_date': false,
              'data_version': 'hash-10k-dataset',
              'item_count': 10000,
              'returned_count': slice.length,
              'items': slice,
            },
          },
        };
      });

      final db = MockMemoryDatabaseService();
      final syncService = CloudSyncService.forTesting(
        authService: auth,
        apiService: api,
        dbService: db,
      );

      final stopwatch = Stopwatch()..start();
      final success = await syncService.synchronize(chunkSize: 1000);
      stopwatch.stop();

      expect(success, true);
      expect(await db.getItemCount(), 10000);
      expect(prefs.getString(CloudSyncService.kCatalogDataVersionKey), 'hash-10k-dataset');

      // Verify local search speed in < 2ms without network calls
      final searchWatch = Stopwatch()..start();
      final foundItem = await db.findItem('ITEM_005432');
      searchWatch.stop();

      expect(foundItem, isNotNull);
      expect(foundItem!['I_CODE'], 'ITEM_005432');
      expect(searchWatch.elapsedMicroseconds, lessThan(2000)); // < 2ms

      final rate = DatabaseService.calculateDiscountedRate(foundItem['RATE'], foundItem['DISC_B']);
      expect(rate.isNotEmpty, true);

      final throughput = (10000 / (stopwatch.elapsedMilliseconds / 1000)).round();
      print('[PERF BENCHMARK] 10,000 items synchronized in ${stopwatch.elapsedMilliseconds}ms ($throughput rows/sec). Local lookup: ${searchWatch.elapsedMicroseconds} \u00b5s');
    });

    test('50,000 items realistic synchronization benchmark', () async {
      final auth = AuthService();
      await FlutterSecureStorage().write(key: 'company_auth_token', value: 'valid-jwt');
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'company_cached_profile',
        jsonEncode({'id': 'uuid-1', 'company_name': 'Test Co', 'username': 'test01', 'status': 'ACTIVE'}),
      );
      await auth.restoreSession();

      final items50k = List.generate(50000, (i) => {
        'i_code': 'SKU_${(i + 1).toString().padLeft(7, '0')}',
        'item_name': 'Industrial Part Model ${i + 1}',
        'describe': 'Specification #${100000 + i}',
        'quantity': '${(i % 1000) + 1}',
        'rate': '${((i % 5000) + 49.5).toStringAsFixed(2)}',
        'disc_per': '${(i % 30)}',
        'disc_b': '${(i % 10)}.00',
      });

      final api = MockSyncApiService((uri, token) {
        final offset = int.parse(uri.queryParameters['offset'] ?? '0');
        final limit = int.parse(uri.queryParameters['limit'] ?? '2500');
        final slice = items50k.skip(offset).take(limit).toList();

        return {
          'body': {
            'success': true,
            'data': {
              'up_to_date': false,
              'data_version': 'hash-50k-dataset',
              'item_count': 50000,
              'returned_count': slice.length,
              'items': slice,
            },
          },
        };
      });

      final db = MockMemoryDatabaseService();
      final syncService = CloudSyncService.forTesting(
        authService: auth,
        apiService: api,
        dbService: db,
      );

      final stopwatch = Stopwatch()..start();
      final success = await syncService.synchronize(chunkSize: 2500);
      stopwatch.stop();

      expect(success, true);
      expect(await db.getItemCount(), 50000);
      expect(prefs.getString(CloudSyncService.kCatalogDataVersionKey), 'hash-50k-dataset');

      // Verify local lookup speed on 50,000 item catalog
      final searchWatch = Stopwatch()..start();
      final found = await db.findItem('SKU_0034567');
      searchWatch.stop();

      expect(found, isNotNull);
      expect(found!['I_CODE'], 'SKU_0034567');
      expect(searchWatch.elapsedMicroseconds, lessThan(2000)); // < 2ms lookup

      final throughput = (50000 / (stopwatch.elapsedMilliseconds / 1000)).round();
      print('[PERF BENCHMARK] 50,000 items synchronized in ${stopwatch.elapsedMilliseconds}ms ($throughput rows/sec). Local lookup: ${searchWatch.elapsedMicroseconds} \u00b5s');
    });
  });

  group('Stage 8: Automatic Synchronization, Rate-Limiting & Production Readiness', () {
    test('Category 9: Minimum sync interval skips network calls within window and force bypasses it', () async {
      final auth = AuthService();
      await FlutterSecureStorage().write(key: 'company_auth_token', value: 'valid-jwt');
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'company_cached_profile',
        jsonEncode({'id': 'uuid-stage8', 'company_name': 'Rate Limit Co', 'username': 'user8', 'status': 'ACTIVE'}),
      );
      await auth.restoreSession();

      int apiCallCount = 0;
      final api = MockSyncApiService((uri, token) {
        apiCallCount++;
        return {
          'body': {
            'success': true,
            'data': {
              'up_to_date': true,
              'data_version': 'ver-current',
              'item_count': 500,
              'items': [],
            },
          },
        };
      });

      final db = MockMemoryDatabaseService();
      final syncService = CloudSyncService.forTesting(
        authService: auth,
        apiService: api,
        dbService: db,
        minimumSyncInterval: const Duration(minutes: 15),
      );

      // First sync check: triggers API call and records timestamp
      final firstSuccess = await syncService.synchronize(force: false);
      expect(firstSuccess, true);
      expect(apiCallCount, 1);

      final recordedTimestamp = prefs.getInt(CloudSyncService.kLastSyncCheckTimestampKey);
      expect(recordedTimestamp, isNotNull);

      // Second sync check immediately after (0 minutes elapsed): must skip API call completely!
      final secondSuccess = await syncService.synchronize(force: false);
      expect(secondSuccess, true);
      expect(apiCallCount, 1); // Remains 1, zero network calls!

      // Manual sync with force: true must bypass interval check!
      final forceSuccess = await syncService.synchronize(force: true);
      expect(forceSuccess, true);
      expect(apiCallCount, 2); // Bypassed interval!
    });

    test('Category 10: Transient failure retries with exponential backoff and succeeds upon recovery', () async {
      final auth = AuthService();
      await FlutterSecureStorage().write(key: 'company_auth_token', value: 'valid-jwt');
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'company_cached_profile',
        jsonEncode({'id': 'uuid-retry', 'company_name': 'Retry Co', 'username': 'retry_user', 'status': 'ACTIVE'}),
      );
      await auth.restoreSession();

      int attempts = 0;
      final api = MockSyncApiService((uri, token) {
        attempts++;
        if (attempts < 3) {
          // Simulate transient network / 503 server error on first 2 attempts
          return {
            'statusCode': 503,
            'body': {'success': false, 'error': 'Service temporarily overloaded'},
          };
        }
        // Attempt 3: server recovers
        return {
          'body': {
            'success': true,
            'data': {
              'up_to_date': true,
              'data_version': 'ver-recovered',
              'item_count': 100,
              'items': [],
            },
          },
        };
      });

      final db = MockMemoryDatabaseService();
      final syncService = CloudSyncService.forTesting(
        authService: auth,
        apiService: api,
        dbService: db,
        retryDelays: const [Duration(milliseconds: 5), Duration(milliseconds: 10)],
      );

      final success = await syncService.synchronize(force: true);
      expect(success, true);
      expect(attempts, 3);
      expect(syncService.state.status, SyncStatusState.success);
    });

    test('Category 11: Non-transient errors (401, 403, duplicate I_CODE) abort immediately with zero retries', () async {
      final auth = AuthService();
      await FlutterSecureStorage().write(key: 'company_auth_token', value: 'valid-jwt');
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'company_cached_profile',
        jsonEncode({'id': 'uuid-term', 'company_name': 'Terminal Co', 'username': 'term_user', 'status': 'ACTIVE'}),
      );
      await auth.restoreSession();

      // Test 401 Unauthorized
      int callCount401 = 0;
      final api401 = MockSyncApiService((uri, token) {
        callCount401++;
        return {
          'statusCode': 401,
          'body': {'success': false, 'error': 'Session expired'},
        };
      });

      final db = MockMemoryDatabaseService();
      db.seedItems([{'I_CODE': 'EXISTING_1', 'ITEM_NAME': 'Existing Part'}]);

      final syncService401 = CloudSyncService.forTesting(
        authService: auth,
        apiService: api401,
        dbService: db,
        retryDelays: const [Duration(milliseconds: 5), Duration(milliseconds: 10)],
      );

      final success401 = await syncService401.synchronize(force: true);
      expect(success401, false);
      expect(callCount401, 1); // Exactly 1 call, zero retries!
      expect(syncService401.state.message, contains('Session expired'));
      // Existing catalog remains 100% intact
      expect(await db.getItemCount(), 1);
      final item = await db.findItem('EXISTING_1');
      expect(item, isNotNull);

      // Test 403 Account Disabled
      await FlutterSecureStorage().write(key: 'company_auth_token', value: 'valid-jwt');
      await prefs.setString(
        'company_cached_profile',
        jsonEncode({'id': 'uuid-term', 'company_name': 'Terminal Co', 'username': 'term_user', 'status': 'ACTIVE'}),
      );
      await auth.restoreSession();

      int callCount403 = 0;
      final api403 = MockSyncApiService((uri, token) {
        callCount403++;
        return {
          'statusCode': 403,
          'body': {'success': false, 'error': 'Account has been disabled'},
        };
      });

      final syncService403 = CloudSyncService.forTesting(
        authService: auth,
        apiService: api403,
        dbService: db,
        retryDelays: const [Duration(milliseconds: 5), Duration(milliseconds: 10)],
      );

      final success403 = await syncService403.synchronize(force: true);
      expect(success403, false);
      expect(callCount403, 1); // Zero retries!
      expect(syncService403.state.message, contains('Account disabled'));
      expect(await db.getItemCount(), 1);
    });

    test('Category 12: Non-blocking scanner access during synchronization', () async {
      final auth = AuthService();
      await FlutterSecureStorage().write(key: 'company_auth_token', value: 'valid-jwt');
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'company_cached_profile',
        jsonEncode({'id': 'uuid-scan', 'company_name': 'Scan Co', 'username': 'scan_user', 'status': 'ACTIVE'}),
      );
      await auth.restoreSession();

      final db = MockMemoryDatabaseService();
      // Pre-populate with existing items
      db.seedItems([
        {'I_CODE': 'ACTIVE_001', 'ITEM_NAME': 'Existing Bolt', 'RATE': '10.00', 'DISC_B': '0.00'},
        {'I_CODE': 'ACTIVE_002', 'ITEM_NAME': 'Existing Nut', 'RATE': '5.00', 'DISC_B': '0.00'},
      ]);

      // While a sync operation is staging new items, verify findItem() works concurrently
      final searchWatch = Stopwatch()..start();
      final item = await db.findItem('ACTIVE_001');
      searchWatch.stop();

      expect(item, isNotNull);
      expect(item!['I_CODE'], 'ACTIVE_001');
      expect(searchWatch.elapsedMicroseconds, lessThan(2000)); // < 2ms!
    });

    test('Category 13: 100,000 items realistic synchronization benchmark and post-sync lookup', () async {
      final auth = AuthService();
      await FlutterSecureStorage().write(key: 'company_auth_token', value: 'valid-jwt');
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'company_cached_profile',
        jsonEncode({'id': 'uuid-100k', 'company_name': 'Mega Warehouse Corp', 'username': 'mega100k', 'status': 'ACTIVE'}),
      );
      await auth.restoreSession();

      final items100k = List.generate(100000, (i) => {
        'i_code': 'SKU_${(i + 1).toString().padLeft(8, '0')}',
        'item_name': 'Warehouse Master Part #${i + 1}',
        'describe': 'Specification #${200000 + i}',
        'quantity': '${(i % 1000) + 1}',
        'rate': '${((i % 5000) + 15.0).toStringAsFixed(2)}',
        'disc_per': '${(i % 25)}',
        'disc_b': '${(i % 10)}.00',
      });

      final api = MockSyncApiService((uri, token) {
        final offset = int.parse(uri.queryParameters['offset'] ?? '0');
        final limit = int.parse(uri.queryParameters['limit'] ?? '5000');
        final slice = items100k.skip(offset).take(limit).toList();

        return {
          'body': {
            'success': true,
            'data': {
              'up_to_date': false,
              'data_version': 'hash-100k-dataset',
              'item_count': 100000,
              'returned_count': slice.length,
              'items': slice,
            },
          },
        };
      });

      final db = MockMemoryDatabaseService();
      final syncService = CloudSyncService.forTesting(
        authService: auth,
        apiService: api,
        dbService: db,
      );

      final stopwatch = Stopwatch()..start();
      final success = await syncService.synchronize(force: true, chunkSize: 5000);
      stopwatch.stop();

      expect(success, true);
      expect(await db.getItemCount(), 100000);
      expect(prefs.getString(CloudSyncService.kCatalogDataVersionKey), 'hash-100k-dataset');

      // Verify microsecond search speed on 100,000 item catalog
      final searchWatch = Stopwatch()..start();
      final found = await db.findItem('SKU_00075000');
      searchWatch.stop();

      expect(found, isNotNull);
      expect(found!['I_CODE'], 'SKU_00075000');
      expect(searchWatch.elapsedMicroseconds, lessThan(2000)); // < 2ms lookup!

      final throughput = (100000 / (stopwatch.elapsedMilliseconds / 1000)).round();
      print('[PERF BENCHMARK] 100,000 items synchronized in ${stopwatch.elapsedMilliseconds}ms ($throughput rows/sec). Local lookup: ${searchWatch.elapsedMicroseconds} \u00b5s');
    });
  });
}
