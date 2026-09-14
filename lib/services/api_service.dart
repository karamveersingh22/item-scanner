import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../models/company_info.dart';
import '../models/sync_item.dart';

class ApiException implements Exception {
  final String message;
  final int? statusCode;
  final bool isUnauthorized;
  final bool isForbidden;
  final bool isNetworkError;

  ApiException(
    this.message, {
    this.statusCode,
    this.isUnauthorized = false,
    this.isForbidden = false,
    this.isNetworkError = false,
  });

  @override
  String toString() => message;
}

class ApiService {
  static const String _kProductionBaseUrl = 'https://itemscanner.vercel.app';

  /// Default backend base URL.
  /// Defaults to production (https://itemscanner.vercel.app).
  /// Can be overridden at build time via:
  ///   --dart-define=BACKEND_BASE_URL=http://10.0.2.2:3000
  static String get defaultBaseUrl {
    return const String.fromEnvironment(
      'BACKEND_BASE_URL',
      defaultValue: _kProductionBaseUrl,
    );
  }

  static const String _kBaseUrlPrefKey = 'api_base_url_custom';

  /// Retrieves the currently configured API base URL.
  Future<String> getBaseUrl() async {
    final prefs = await SharedPreferences.getInstance();
    final custom = prefs.getString(_kBaseUrlPrefKey);
    if (custom != null && custom.trim().isNotEmpty) {
      return _normalizeUrl(custom.trim());
    }
    return defaultBaseUrl;
  }

  /// Sets a custom API base URL (e.g. for switching to staging or cloud deployment).
  Future<void> setBaseUrl(String url) async {
    final prefs = await SharedPreferences.getInstance();
    final normalized = _normalizeUrl(url);
    await prefs.setString(_kBaseUrlPrefKey, normalized);
  }

  /// Resets to default base URL.
  Future<void> resetBaseUrl() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kBaseUrlPrefKey);
  }

  String _normalizeUrl(String url) {
    String clean = url.trim();
    while (clean.endsWith('/')) {
      clean = clean.substring(0, clean.length - 1);
    }
    return clean;
  }

  void _ensureNetworkAllowed() {
    if (!kIsWeb) {
      try {
        if (Platform.environment.containsKey('FLUTTER_TEST')) {
          throw const SocketException('Network access disabled in unit test environment');
        }
      } catch (e) {
        if (e is SocketException) rethrow;
      }
    }
  }

  /// Authenticate company with shared credentials:
  /// POST /api/auth/login
  Future<({String token, CompanyInfo company})> login({
    required String username,
    required String password,
    String? overrideBaseUrl,
  }) async {
    final base = overrideBaseUrl ?? await getBaseUrl();
    final uri = Uri.parse('$base/api/auth/login');

    try {
      _ensureNetworkAllowed();
      final response = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'username': username.trim(),
              'password': password,
            }),
          )
          .timeout(const Duration(seconds: 15));

      final Map<String, dynamic> body = _parseJsonResponse(response.body);

      if (response.statusCode == 200 && body['success'] == true) {
        final data = body['data'] as Map<String, dynamic>;
        final token = data['token']?.toString() ?? '';
        final companyJson = data['company'] as Map<String, dynamic>;
        final company = CompanyInfo.fromJson(companyJson);

        return (token: token, company: company);
      }

      if (response.statusCode == 401) {
        throw ApiException(
          body['error']?.toString() ?? 'Invalid username or password',
          statusCode: 401,
          isUnauthorized: true,
        );
      }

      if (response.statusCode == 403) {
        throw ApiException(
          body['error']?.toString() ?? 'Company account has been disabled. Please contact support.',
          statusCode: 403,
          isForbidden: true,
        );
      }

      throw ApiException(
        body['error']?.toString() ?? 'Login failed (${response.statusCode})',
        statusCode: response.statusCode,
      );
    } on SocketException {
      throw ApiException(
        'Unable to connect to server. Please check your internet connection or server address.',
        isNetworkError: true,
      );
    } on TimeoutException {
      throw ApiException(
        'Server connection timed out. Please try again.',
        isNetworkError: true,
      );
    } on http.ClientException {
      throw ApiException(
        'Network error occurred. Please verify your connection.',
        isNetworkError: true,
      );
    }
  }

  /// Verify session token and retrieve current company profile:
  /// GET /api/auth/me
  Future<CompanyInfo> getMe({
    required String token,
    String? overrideBaseUrl,
  }) async {
    final base = overrideBaseUrl ?? await getBaseUrl();
    final uri = Uri.parse('$base/api/auth/me');

    try {
      _ensureNetworkAllowed();
      final response = await http.get(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 10));

      final Map<String, dynamic> body = _parseJsonResponse(response.body);

      if (response.statusCode == 200 && body['success'] == true) {
        final data = body['data'] as Map<String, dynamic>;
        final companyJson = data['company'] as Map<String, dynamic>;
        return CompanyInfo.fromJson(companyJson);
      }

      if (response.statusCode == 401) {
        throw ApiException(
          'Authentication session expired. Please log in again.',
          statusCode: 401,
          isUnauthorized: true,
        );
      }

      if (response.statusCode == 403) {
        throw ApiException(
          body['error']?.toString() ?? 'Company account has been disabled.',
          statusCode: 403,
          isForbidden: true,
        );
      }

      throw ApiException(
        body['error']?.toString() ?? 'Failed to verify session',
        statusCode: response.statusCode,
      );
    } on SocketException {
      throw ApiException(
        'Network unreachable. Operating in offline mode.',
        isNetworkError: true,
      );
    } on TimeoutException {
      throw ApiException(
        'Connection timed out while verifying session.',
        isNetworkError: true,
      );
    }
  }

  /// Logout notification to backend:
  /// POST /api/auth/logout
  Future<void> logout({
    required String token,
    String? overrideBaseUrl,
  }) async {
    final base = overrideBaseUrl ?? await getBaseUrl();
    final uri = Uri.parse('$base/api/auth/logout');

    try {
      await http.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 5));
    } catch (_) {
      // Best-effort logout notification; ignore network errors during local logout
    }
  }

  /// Fetch cloud catalog data:
  /// `GET /api/sync/data?version=<version>&limit=<limit>&offset=<offset>`
  Future<SyncDataResponse> fetchSyncData({
    required String token,
    String? version,
    int? limit,
    int? offset,
    String? overrideBaseUrl,
  }) async {
    final base = overrideBaseUrl ?? await getBaseUrl();
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

    final uri = Uri.parse('$base/api/sync/data').replace(
      queryParameters: queryParams.isNotEmpty ? queryParams : null,
    );

    try {
      _ensureNetworkAllowed();
      final response = await http.get(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 30));

      final Map<String, dynamic> body = _parseJsonResponse(response.body);

      if (response.statusCode == 200 && body['success'] == true) {
        final data = body['data'] as Map<String, dynamic>? ?? {};
        return SyncDataResponse.fromJson(data);
      }

      if (response.statusCode == 401) {
        throw ApiException(
          'Authentication session expired. Please log in again.',
          statusCode: 401,
          isUnauthorized: true,
        );
      }

      if (response.statusCode == 403) {
        throw ApiException(
          body['error']?.toString() ?? 'Company account has been disabled.',
          statusCode: 403,
          isForbidden: true,
        );
      }

      throw ApiException(
        body['error']?.toString() ?? 'Failed to fetch catalog data (${response.statusCode})',
        statusCode: response.statusCode,
      );
    } on SocketException {
      throw ApiException(
        'Unable to connect to server. Check your network connection.',
        isNetworkError: true,
      );
    } on TimeoutException {
      throw ApiException(
        'Server connection timed out while fetching catalog data.',
        isNetworkError: true,
      );
    } on http.ClientException catch (e) {
      throw ApiException(
        'Network communication error: ${e.message}',
        isNetworkError: true,
      );
    }
  }

  Map<String, dynamic> _parseJsonResponse(String raw) {
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return {};
    }
  }
}
