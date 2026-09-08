import 'dart:typed_data';
import 'package:excel/excel.dart';

class ExcelService {
  Future<List<Map<String, dynamic>>> readExcel(
    Uint8List bytes,
  ) async {
    final excel = Excel.decodeBytes(bytes);

    if (excel.tables.isEmpty) {
      throw Exception('No worksheet found in Excel file.');
    }

    final sheet = excel.tables.values.first;

    if (sheet.maxRows < 2) {
      throw Exception('Excel file does not contain item data.');
    }

    final headers = sheet.rows.first.map((cell) {
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

    if (iCodeIndex == -1) {
      throw Exception('I_CODE column not found.');
    }

    String getValue(List<Data?> row, int index) {
      if (index < 0 || index >= row.length) {
        return '';
      }

      return row[index]?.value?.toString().trim() ?? '';
    }

    final List<Map<String, dynamic>> items = [];

    for (int rowIndex = 1; rowIndex < sheet.rows.length; rowIndex++) {
      final row = sheet.rows[rowIndex];

      final code = getValue(row, iCodeIndex);

      if (code.isEmpty) {
        continue;
      }

      items.add({
        'I_CODE': code,
        'ITEM_NAME': getValue(row, itemNameIndex),
        'DESCRIBE': getValue(row, describeIndex),
        'QUANTITY': getValue(row, quantityIndex),
        'RATE': getValue(row, rateIndex),
        'DISC_PER': getValue(row, discPerIndex),
        'DISC_B': discBIndex >= 0 ? getValue(row, discBIndex) : '',
      });
    }

    return items;
  }
}