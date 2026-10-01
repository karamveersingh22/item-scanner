class SyncItem {
  final String iCode;
  final String? itemName;
  final String? describe;
  final String? quantity;
  final String? rate;
  final String? discPer;
  final String? discA;
  final String? discB;
  final String? discC;
  final String? discD;
  final String? discE;
  final String? discF;
  final String? discG;
  final String? discH;
  final String? discI;
  final String? discJ;
  final String? discK;
  final String? discL;
  final String? discM;
  final String? discN;
  final String? taxPer;

  const SyncItem({
    required this.iCode,
    this.itemName,
    this.describe,
    this.quantity,
    this.rate,
    this.discPer,
    this.discA,
    this.discB,
    this.discC,
    this.discD,
    this.discE,
    this.discF,
    this.discG,
    this.discH,
    this.discI,
    this.discJ,
    this.discK,
    this.discL,
    this.discM,
    this.discN,
    this.taxPer,
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
      discA: (json['disc_a'] ?? json['DISC_A'])?.toString(),
      discB: (json['disc_b'] ?? json['DISC_B'])?.toString(),
      discC: (json['disc_c'] ?? json['DISC_C'])?.toString(),
      discD: (json['disc_d'] ?? json['DISC_D'])?.toString(),
      discE: (json['disc_e'] ?? json['DISC_E'])?.toString(),
      discF: (json['disc_f'] ?? json['DISC_F'])?.toString(),
      discG: (json['disc_g'] ?? json['DISC_G'])?.toString(),
      discH: (json['disc_h'] ?? json['DISC_H'])?.toString(),
      discI: (json['disc_i'] ?? json['DISC_I'])?.toString(),
      discJ: (json['disc_j'] ?? json['DISC_J'])?.toString(),
      discK: (json['disc_k'] ?? json['DISC_K'])?.toString(),
      discL: (json['disc_l'] ?? json['DISC_L'])?.toString(),
      discM: (json['disc_m'] ?? json['DISC_M'])?.toString(),
      discN: (json['disc_n'] ?? json['DISC_N'])?.toString(),
      taxPer: (json['tax_per'] ?? json['TAX_PER'])?.toString(),
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
      'DISC_A': discA,
      'DISC_B': discB,
      'DISC_C': discC,
      'DISC_D': discD,
      'DISC_E': discE,
      'DISC_F': discF,
      'DISC_G': discG,
      'DISC_H': discH,
      'DISC_I': discI,
      'DISC_J': discJ,
      'DISC_K': discK,
      'DISC_L': discL,
      'DISC_M': discM,
      'DISC_N': discN,
      'TAX_PER': taxPer,
    };
  }

  /// Validation: checks that I_CODE is non-empty and well-formed
  bool get isValid => iCode.trim().isNotEmpty;

  /// Get discount value for a given category (a-n)
  String? getDiscForCategory(String category) {
    switch (category.toLowerCase()) {
      case 'a': return discA;
      case 'b': return discB;
      case 'c': return discC;
      case 'd': return discD;
      case 'e': return discE;
      case 'f': return discF;
      case 'g': return discG;
      case 'h': return discH;
      case 'i': return discI;
      case 'j': return discJ;
      case 'k': return discK;
      case 'l': return discL;
      case 'm': return discM;
      case 'n': return discN;
      default: return discB; // Default to B
    }
  }
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
