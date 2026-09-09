import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:item_scanner/models/company_info.dart';
import 'package:item_scanner/services/api_service.dart';
import 'package:item_scanner/services/auth_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });

  group('CompanyInfo Model', () {
    test('serializes and deserializes correctly', () {
      final json = {
        'id': 'uuid-1234',
        'company_name': 'ABC Traders',
        'username': 'ABC001',
        'status': 'ACTIVE',
        'last_sync_at': '2026-09-07T12:00:00Z',
        'sync_status': 'SUCCESS',
        'item_count': 500,
      };

      final company = CompanyInfo.fromJson(json);
      expect(company.id, 'uuid-1234');
      expect(company.companyName, 'ABC Traders');
      expect(company.username, 'ABC001');
      expect(company.status, 'ACTIVE');
      expect(company.isActive, true);
      expect(company.itemCount, 500);

      final outJson = company.toJson();
      expect(outJson['id'], 'uuid-1234');
      expect(outJson['company_name'], 'ABC Traders');
      expect(outJson['username'], 'ABC001');
    });

    test('isActive returns false when status is DISABLED', () {
      final company = CompanyInfo(
        id: 'uuid-5678',
        companyName: 'Disabled Corp',
        username: 'DIS001',
        status: 'DISABLED',
      );
      expect(company.isActive, false);
    });
  });

  group('ApiService Configuration & Error Handling', () {
    test('defaultBaseUrl is defined and valid', () {
      final url = ApiService.defaultBaseUrl;
      expect(url, 'https://item-scanner-beryl.vercel.app');
    });

    test('custom SharedPreferences URL override and reset work correctly', () async {
      SharedPreferences.setMockInitialValues({});
      final api = ApiService();
      expect(await api.getBaseUrl(), 'https://item-scanner-beryl.vercel.app');

      await api.setBaseUrl('http://10.0.2.2:3000/');
      expect(await api.getBaseUrl(), 'http://10.0.2.2:3000');

      await api.resetBaseUrl();
      expect(await api.getBaseUrl(), 'https://item-scanner-beryl.vercel.app');
    });

    test('ApiException properties capture error states', () {
      final unauth = ApiException('Unauthorized', statusCode: 401, isUnauthorized: true);
      expect(unauth.isUnauthorized, true);
      expect(unauth.statusCode, 401);

      final forbidden = ApiException('Forbidden', statusCode: 403, isForbidden: true);
      expect(forbidden.isForbidden, true);

      final netErr = ApiException('Network down', isNetworkError: true);
      expect(netErr.isNetworkError, true);
    });
  });

  group('AuthService State', () {
    test('restoreSession returns null when no token is stored', () async {
      final auth = AuthService();
      final session = await auth.restoreSession();
      expect(session, isNull);
      expect(auth.isAuthenticated, false);
    });

    test('logout clears stored credentials', () async {
      final auth = AuthService();
      await auth.logout();
      expect(auth.currentToken, isNull);
      expect(auth.currentCompany, isNull);
      expect(auth.isAuthenticated, false);
    });
  });
}
