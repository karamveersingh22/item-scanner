import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/company_info.dart';
import 'api_service.dart';

class AuthService {
  static final AuthService _instance = AuthService._internal();
  factory AuthService() => _instance;
  AuthService._internal();

  final ApiService _apiService = ApiService();
  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();

  static const String _kTokenKey = 'company_auth_token';
  static const String _kCompanyProfileKey = 'company_cached_profile';

  CompanyInfo? _currentCompany;
  String? _currentToken;

  CompanyInfo? get currentCompany => _currentCompany;
  String? get currentToken => _currentToken;
  bool get isAuthenticated => _currentToken != null && _currentCompany != null;

  /// Authenticate company with username and password.
  /// Securely stores the resulting JWT token in encrypted platform storage.
  Future<CompanyInfo> login({
    required String username,
    required String password,
    String? customBaseUrl,
  }) async {
    if (customBaseUrl != null && customBaseUrl.trim().isNotEmpty) {
      await _apiService.setBaseUrl(customBaseUrl.trim());
    }

    final result = await _apiService.login(
      username: username,
      password: password,
    );

    _currentToken = result.token;
    _currentCompany = result.company;

    // 1. Store token in encrypted platform storage (Keychain / EncryptedSharedPreferences)
    await _secureStorage.write(key: _kTokenKey, value: result.token);

    // 2. Cache safe company metadata in SharedPreferences for offline restoration
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kCompanyProfileKey, jsonEncode(result.company.toJson()));

    return result.company;
  }

  /// Restore authentication session on application launch.
  ///
  /// Flow:
  /// 1. Reads encrypted JWT token from platform secure storage.
  /// 2. If token exists, calls GET /api/auth/me to verify validity.
  /// 3. If token expired or account disabled: clears session, returns null (prompts login).
  /// 4. If device is offline: gracefully restores cached company profile so offline
  ///    scanning continues working seamlessly without internet.
  Future<CompanyInfo?> restoreSession() async {
    try {
      final token = await _secureStorage.read(key: _kTokenKey);
      if (token == null || token.trim().isEmpty) {
        _currentToken = null;
        _currentCompany = null;
        return null;
      }

      _currentToken = token;

      try {
        // Verify with backend
        final company = await _apiService.getMe(token: token);
        _currentCompany = company;

        // Update local metadata cache
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(_kCompanyProfileKey, jsonEncode(company.toJson()));

        return company;
      } on ApiException catch (e) {
        if (e.isUnauthorized || e.isForbidden) {
          // Token expired, revoked, or account disabled: clear local session
          debugPrint('Session invalid (${e.message}). Logging out.');
          await logout();
          return null;
        }

        if (e.isNetworkError) {
          // Device is offline: fallback to cached company profile
          debugPrint('Backend unreachable during session check. Falling back to offline session.');
          final cachedCompany = await _loadCachedProfile();
          if (cachedCompany != null && cachedCompany.isActive) {
            _currentCompany = cachedCompany;
            return cachedCompany;
          }
        }

        // Other API error: clear session to be safe
        await logout();
        return null;
      }
    } catch (e) {
      debugPrint('Session restoration error: $e');
      return null;
    }
  }

  /// Terminates the authenticated session.
  /// Clears encrypted token and company profile.
  /// Does NOT delete the local SQLite item database so data is preserved.
  Future<void> logout() async {
    final token = _currentToken;
    _currentToken = null;
    _currentCompany = null;

    try {
      if (token != null) {
        await _apiService.logout(token: token);
      }
    } catch (_) {
      // Ignore network failures on logout
    }

    try {
      await _secureStorage.delete(key: _kTokenKey);
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_kCompanyProfileKey);
    } catch (e) {
      debugPrint('Error clearing session storage: $e');
    }
  }

  Future<CompanyInfo?> _loadCachedProfile() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final jsonStr = prefs.getString(_kCompanyProfileKey);
      if (jsonStr != null && jsonStr.isNotEmpty) {
        final map = jsonDecode(jsonStr) as Map<String, dynamic>;
        return CompanyInfo.fromJson(map);
      }
    } catch (_) {}
    return null;
  }
}
