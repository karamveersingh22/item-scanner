class CompanyInfo {
  final String id;
  final String companyName;
  final String username;
  final String status;
  final String? lastSyncAt;
  final String? syncStatus;
  final int itemCount;

  const CompanyInfo({
    required this.id,
    required this.companyName,
    required this.username,
    required this.status,
    this.lastSyncAt,
    this.syncStatus,
    this.itemCount = 0,
  });

  factory CompanyInfo.fromJson(Map<String, dynamic> json) {
    return CompanyInfo(
      id: json['id']?.toString() ?? '',
      companyName: json['company_name']?.toString() ?? '',
      username: json['username']?.toString() ?? '',
      status: json['status']?.toString() ?? 'ACTIVE',
      lastSyncAt: json['last_sync_at']?.toString(),
      syncStatus: json['sync_status']?.toString(),
      itemCount: json['item_count'] is int ? json['item_count'] : int.tryParse(json['item_count']?.toString() ?? '0') ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'company_name': companyName,
      'username': username,
      'status': status,
      'last_sync_at': lastSyncAt,
      'sync_status': syncStatus,
      'item_count': itemCount,
    };
  }

  bool get isActive => status.toUpperCase() == 'ACTIVE';
}
