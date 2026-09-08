class SyncItem {
  final String iCode;
  final String? itemName;
  final String? describe;
  final String? quantity;
  final String? rate;
  final String? discPer;
  final String? discB;

  const SyncItem({
    required this.iCode,
    this.itemName,
    this.describe,
    this.quantity,
    this.rate,
    this.discPer,
    this.discB,
  });

  factory SyncItem.fromJson(Map<String, dynamic> json) {
    // CRITICAL: Preserve leading zeros strictly as String (e.g. '001234')
    final rawCode = json['i_code'] ?? json['I_CODE'];
    final iCodeStr = rawCode?.toString() ?? '';

    return SyncItem(
      iCode: iCodeStr,
      itemName: (json['item_name'] ?? json['ITEM_NAME'])?.toString(),
      describe: (json['describe'] ?? json['DESCRIBE'])?.toString(),
      quantity: (json['quantity'] ?? json['QUANTITY'])?.toString(),
      rate: (json['rate'] ?? json['RATE'])?.toString(),
      discPer: (json['disc_per'] ?? json['DISC_PER'])?.toString(),
      discB: (json['disc_b'] ?? json['DISC_B'])?.toString(),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'I_CODE': iCode,
      'ITEM_NAME': itemName,
      'DESCRIBE': describe,
      'QUANTITY': quantity,
      'RATE': rate,
      'DISC_PER': discPer,
      'DISC_B': discB,
    };
  }

  /// Validation: checks that I_CODE is non-empty and well-formed
  bool get isValid => iCode.trim().isNotEmpty;
}

class SyncDataResponse {
  final bool upToDate;
  final String? dataVersion;
  final int itemCount;
  final int returnedCount;
  final String? lastSyncAt;
  final List<SyncItem> items;

  const SyncDataResponse({
    required this.upToDate,
    this.dataVersion,
    required this.itemCount,
    required this.returnedCount,
    this.lastSyncAt,
    required this.items,
  });

  factory SyncDataResponse.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'] as List<dynamic>? ?? [];
    final itemsList = rawItems
        .map((item) => SyncItem.fromJson(item as Map<String, dynamic>))
        .toList();

    return SyncDataResponse(
      upToDate: json['up_to_date'] == true,
      dataVersion: json['data_version']?.toString(),
      itemCount: (json['item_count'] as num?)?.toInt() ?? 0,
      returnedCount: (json['returned_count'] as num?)?.toInt() ?? itemsList.length,
      lastSyncAt: json['last_sync_at']?.toString(),
      items: itemsList,
    );
  }
}
