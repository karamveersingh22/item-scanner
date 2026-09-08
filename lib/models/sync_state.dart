enum SyncStatusState {
  idle,
  checking,
  downloading,
  validating,
  publishing,
  success,
  failed,
}

class SyncState {
  final SyncStatusState status;
  final double? progress; // 0.0 to 1.0
  final int downloadedCount;
  final int totalCount;
  final DateTime? lastSyncTime;
  final String? currentVersion;
  final String? lastError;
  final String message;

  const SyncState({
    required this.status,
    this.progress,
    this.downloadedCount = 0,
    this.totalCount = 0,
    this.lastSyncTime,
    this.currentVersion,
    this.lastError,
    this.message = '',
  });

  bool get isSyncing =>
      status == SyncStatusState.checking ||
      status == SyncStatusState.downloading ||
      status == SyncStatusState.validating ||
      status == SyncStatusState.publishing;

  bool get isSuccess => status == SyncStatusState.success;
  bool get isFailed => status == SyncStatusState.failed;
  bool get isIdle => status == SyncStatusState.idle;

  SyncState copyWith({
    SyncStatusState? status,
    double? progress,
    int? downloadedCount,
    int? totalCount,
    DateTime? lastSyncTime,
    String? currentVersion,
    String? lastError,
    String? message,
  }) {
    return SyncState(
      status: status ?? this.status,
      progress: progress ?? this.progress,
      downloadedCount: downloadedCount ?? this.downloadedCount,
      totalCount: totalCount ?? this.totalCount,
      lastSyncTime: lastSyncTime ?? this.lastSyncTime,
      currentVersion: currentVersion ?? this.currentVersion,
      lastError: lastError ?? this.lastError,
      message: message ?? this.message,
    );
  }

  factory SyncState.initial() {
    return const SyncState(
      status: SyncStatusState.idle,
      message: 'Ready to synchronize',
    );
  }
}
