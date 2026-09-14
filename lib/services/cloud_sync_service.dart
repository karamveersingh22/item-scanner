// ignore_for_file: prefer_initializing_formals

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/sync_state.dart';
import 'api_service.dart';
import 'auth_service.dart';
import 'database_service.dart';

class CloudSyncService {
  static final CloudSyncService _instance = CloudSyncService._internal();
  factory CloudSyncService() => _instance;

  final AuthService _authService;
  final ApiService _apiService;
  final DatabaseService _dbService;

  CloudSyncService._internal({
    AuthService? authService,
    ApiService? apiService,
    DatabaseService? dbService,
  })  : _authService = authService ?? AuthService(),
        _apiService = apiService ?? ApiService(),
        _dbService = dbService ?? DatabaseService();

  /// Visible for testing constructor to allow dependency injection
  @visibleForTesting
  CloudSyncService.forTesting({
    required AuthService authService,
    required ApiService apiService,
    required DatabaseService dbService,
    Duration? minimumSyncInterval,
    List<Duration>? retryDelays,
  })  : _authService = authService,
        _apiService = apiService,
        _dbService = dbService,
        minimumSyncInterval = minimumSyncInterval ?? kDefaultMinimumSyncInterval,
        retryDelays = retryDelays ?? const [Duration(milliseconds: 1), Duration(milliseconds: 2)];

  static const String kCatalogDataVersionKey = 'catalog_data_version';
  static const String kLastSyncTimeKey = 'last_sync_time';
  static const String kLastSyncCheckTimestampKey = 'last_sync_check_timestamp';
  static const int kDefaultChunkSize = 1000;
  static const Duration kDefaultMinimumSyncInterval = Duration(minutes: 15);
  static const List<Duration> kDefaultRetryDelays = [
    Duration(seconds: 2),
    Duration(seconds: 5),
    Duration(seconds: 15),
  ];

  Duration minimumSyncInterval = kDefaultMinimumSyncInterval;
  List<Duration> retryDelays = kDefaultRetryDelays;

  final ValueNotifier<SyncState> stateNotifier =
      ValueNotifier<SyncState>(SyncState.initial());

  SyncState get state => stateNotifier.value;

  Future<String?> getLocalDataVersion() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(kCatalogDataVersionKey);
  }

  Future<void> setLocalDataVersion(String version) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(kCatalogDataVersionKey, version);
  }

  Future<int?> getLastSyncCheckTimestamp() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getInt(kLastSyncCheckTimestampKey);
  }

  /// Coordinates cloud catalog synchronization:
  /// 1. Verifies authentication session.
  /// 2. If not forced, checks minimumSyncInterval (15m default).
  /// 3. Reads local catalog_data_version.
  /// 4. Checks `GET /api/sync/data?version=<local>`.
  /// 5. If up_to_date: updates check timestamp and returns immediately.
  /// 6. If new catalog: downloads in chunks into items_staging with validation.
  /// 7. Atomically publishes staging into items table inside SQLite transaction.
  /// 8. Retries transient failures with exponential backoff (2s, 5s, 15s).
  /// 9. Fails fast without retry on 401, 403, duplicate items, or validation errors.
  Future<bool> synchronize({
    bool force = false,
    int chunkSize = kDefaultChunkSize,
  }) async {
    if (state.isSyncing) {
      debugPrint('[CloudSyncService] Synchronization is already in progress.');
      return false;
    }

    // 1. Verify authentication
    if (!_authService.isAuthenticated || _authService.currentToken == null) {
      stateNotifier.value = state.copyWith(
        status: SyncStatusState.failed,
        lastError: 'Not authenticated. Please log in first.',
        message: 'Authentication required to synchronize.',
      );
      return false;
    }

    final token = _authService.currentToken!;

    // 2. Enforce minimum sync interval for automatic / background checks
    final prefs = await SharedPreferences.getInstance();
    final now = DateTime.now();
    if (!force) {
      final lastCheck = prefs.getInt(kLastSyncCheckTimestampKey);
      if (lastCheck != null) {
        final lastCheckDate = DateTime.fromMillisecondsSinceEpoch(lastCheck);
        if (now.difference(lastCheckDate) < minimumSyncInterval) {
          debugPrint(
            '[CloudSyncService] Minimum sync interval (${minimumSyncInterval.inMinutes}m) not elapsed. Skipping auto-check.',
          );
          return true;
        }
      }
    }

    // Read local data version
    final localVersion = force ? null : await getLocalDataVersion();

    // 2.5 One-click Drive -> Blob -> Phone: on manual SYNC, trigger Drive publish first
    // After one-time /admin setup, client only uses Drive + this button, no website needed.
    if (force) {
      try {
        stateNotifier.value = state.copyWith(
          status: SyncStatusState.checking,
          message: 'Syncing Google Drive to cloud...',
        );
        await _apiService.triggerSync(token: token);
      } on ApiException catch (e) {
        if (e.statusCode == 409) {
          debugPrint('[CloudSyncService] Server sync already in progress, proceeding to fetch');
        } else if (e.isUnauthorized || e.statusCode == 403) {
          rethrow;
        } else if (e.statusCode == 400) {
          // Excel error (duplicate I_CODE, missing columns) - fail fast with message
          rethrow;
        } else if (e.isNetworkError || (e.statusCode != null && e.statusCode! >= 500)) {
          // Transient - let outer retry handle
          rethrow;
        } else {
          debugPrint('[CloudSyncService] Trigger warning: ${e.message}, trying fetch anyway');
        }
      }
    }

    // 3. Retry loop with bounded exponential backoff
    int attempt = 0;
    while (true) {
      try {
        stateNotifier.value = state.copyWith(
          status: SyncStatusState.checking,
          progress: null,
          message: attempt > 0
              ? 'Retrying synchronization (attempt ${attempt + 1}/${retryDelays.length + 1})...'
              : 'Checking for cloud catalog updates...',
          lastError: null,
        );

        final result = await _executeSingleAttempt(
          token: token,
          localVersion: localVersion,
          chunkSize: chunkSize,
          prefs: prefs,
        );

        // Record check timestamp upon successful check or sync
        await prefs.setInt(kLastSyncCheckTimestampKey, DateTime.now().millisecondsSinceEpoch);
        return result;
      } catch (e) {
        await _dbService.cleanUpStaging();

        final isTransient = _isTransientError(e);
        if (isTransient && attempt < retryDelays.length) {
          final backoff = retryDelays[attempt];
          attempt++;
          stateNotifier.value = state.copyWith(
            status: SyncStatusState.checking,
            message: 'Connection issue. Retrying in ${backoff.inSeconds}s (attempt $attempt/${retryDelays.length})...',
          );
          await Future.delayed(backoff);
          continue;
        }

        // Terminal failure or exhausted retries
        await _handleTerminalError(e);
        return false;
      }
    }
  }

  bool _isTransientError(dynamic error) {
    if (error is ApiException) {
      if (error.isUnauthorized || error.statusCode == 403) {
        return false; // Authentication/permission errors are never transient
      }
      if (error.isNetworkError) return true;
      if (error.statusCode != null && error.statusCode! >= 500) return true;
    }
    return false;
  }

  Future<void> _handleTerminalError(dynamic error) async {
    if (error is ApiException) {
      if (error.isUnauthorized) {
        await _authService.logout();
        stateNotifier.value = state.copyWith(
          status: SyncStatusState.failed,
          lastError: error.message,
          message: 'Session expired. Please log in again.',
        );
        return;
      }
      if (error.statusCode == 403) {
        stateNotifier.value = state.copyWith(
          status: SyncStatusState.failed,
          lastError: error.message,
          message: 'Account disabled. Please contact administrator.',
        );
        return;
      }
      stateNotifier.value = state.copyWith(
        status: SyncStatusState.failed,
        lastError: error.message,
        message: error.isNetworkError
            ? 'Network unavailable. Using offline catalog.'
            : 'Sync failed: ${error.message}',
      );
      return;
    }

    final errStr = error.toString().replaceFirst('Exception: ', '');
    stateNotifier.value = state.copyWith(
      status: SyncStatusState.failed,
      lastError: errStr,
      message: 'Sync failed: $errStr',
    );
  }

  Future<bool> _executeSingleAttempt({
    required String token,
    required String? localVersion,
    required int chunkSize,
    required SharedPreferences prefs,
  }) async {
    // Initial check / first page fetch
    final firstPage = await _apiService.fetchSyncData(
      token: token,
      version: localVersion,
      limit: chunkSize,
      offset: 0,
    );

    // If server reports client is up to date, skip downloading
    if (firstPage.upToDate) {
      final now = DateTime.now();
      stateNotifier.value = state.copyWith(
        status: SyncStatusState.success,
        progress: 1.0,
        currentVersion: firstPage.dataVersion ?? localVersion,
        lastSyncTime: now,
        message: 'Catalog is up to date \u2713',
      );
      return true;
    }

    final totalItems = firstPage.itemCount;
    final newVersion = firstPage.dataVersion;

    if (newVersion == null || newVersion.isEmpty) {
      throw Exception('Server returned invalid empty data_version.');
    }

    if (totalItems == 0) {
      throw Exception('Server returned an empty item catalog.');
    }

    // Prepare staging table (leaving active items catalog completely untouched)
    await _dbService.clearStaging();

    final seenICodes = <String>{};
    int totalDownloaded = 0;

    // Process first page
    stateNotifier.value = state.copyWith(
      status: SyncStatusState.downloading,
      totalCount: totalItems,
      downloadedCount: 0,
      progress: 0.0,
      message: 'Downloading catalog (0 / $totalItems)...',
    );

    void validateAndStage(List<dynamic> items) {
      final rowsToInsert = <Map<String, dynamic>>[];
      for (final it in items) {
        final syncItem = it;
        final code = syncItem.iCode.trim();

        if (code.isEmpty) {
          throw Exception('Spreadsheet contains invalid empty I_CODE.');
        }

        // Duplicate detection: reject catalog to prevent ambiguous lookups
        if (seenICodes.contains(code)) {
          throw Exception(
            "Found duplicate item code: '$code'. Catalog synchronization rejected.",
          );
        }
        seenICodes.add(code);

        rowsToInsert.add(syncItem.toMap());
      }

      _dbService.insertStagingBatch(rowsToInsert);
      totalDownloaded += rowsToInsert.length;
    }

    validateAndStage(firstPage.items);

    stateNotifier.value = state.copyWith(
      downloadedCount: totalDownloaded,
      progress: totalDownloaded / totalItems,
      message: 'Downloading catalog ($totalDownloaded / $totalItems)...',
    );

    // Paginate remaining pages if catalog exceeds chunkSize
    while (totalDownloaded < totalItems) {
      final page = await _apiService.fetchSyncData(
        token: token,
        version: null, // Request actual data for remaining pages
        limit: chunkSize,
        offset: totalDownloaded,
      );

      if (page.items.isEmpty) {
        throw Exception(
          'Incomplete catalog received from server. Expected $totalItems but received $totalDownloaded.',
        );
      }

      validateAndStage(page.items);

      stateNotifier.value = state.copyWith(
        downloadedCount: totalDownloaded,
        progress: totalDownloaded / totalItems,
        message: 'Downloading catalog ($totalDownloaded / $totalItems)...',
      );
    }

    // Validate staging dataset completeness
    stateNotifier.value = state.copyWith(
      status: SyncStatusState.validating,
      message: 'Validating staged catalog records...',
    );

    final stagedCount = await _dbService.getStagingCount();
    if (stagedCount != totalItems) {
      throw Exception(
        'Staging validation mismatch: expected $totalItems records but found $stagedCount in staging table.',
      );
    }

    // Atomic replacement: swap staging into items inside a single SQLite transaction
    stateNotifier.value = state.copyWith(
      status: SyncStatusState.publishing,
      message: 'Installing updated catalog atomically...',
    );

    final publishedCount = await _dbService.atomicallyPublishStaging();

    // Update local data_version and sync timestamp ONLY after successful commit
    await prefs.setString(kCatalogDataVersionKey, newVersion);

    final now = DateTime.now();
    final hour = now.hour > 12 ? now.hour - 12 : (now.hour == 0 ? 12 : now.hour);
    final minute = now.minute.toString().padLeft(2, '0');
    final ampm = now.hour >= 12 ? 'PM' : 'AM';
    final formattedTime =
        '${now.day.toString().padLeft(2, '0')}/${now.month.toString().padLeft(2, '0')}/${now.year} $hour:$minute $ampm';
    await prefs.setString(kLastSyncTimeKey, formattedTime);

    stateNotifier.value = state.copyWith(
      status: SyncStatusState.success,
      progress: 1.0,
      downloadedCount: publishedCount,
      totalCount: publishedCount,
      currentVersion: newVersion,
      lastSyncTime: now,
      message: '$publishedCount items synchronized \u2713',
    );

    return true;
  }
}
