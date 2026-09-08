import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:item_scanner/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('Item Scanner app starts', (tester) async {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});

    await tester.pumpWidget(
      const ItemScannerApp(),
    );
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    expect(
      find.text('ITEM MASTER'),
      findsOneWidget,
    );
  });
}