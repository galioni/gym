/// HTTP client for the Vercel `api/*` routes. The server contract is the web app's: bearer token from
/// Supabase, JSON bodies, errors as `{ error, retryAfter?, plan?, requestId? }`.
///
/// A 401 means the token was rejected (expired or revoked), so the client refreshes it and retries once; a
/// second 401 is surfaced as-is so the UI can send the user back to sign-in.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../auth/auth_models.dart';
import '../domain/rules.dart';
import 'plan_generation.dart';
import 'subscription.dart';

class ApiException implements Exception {
  const ApiException(this.status, this.message, {this.retryAfterSeconds, this.plan, this.requestId});

  /// 0 when the request never got a response (offline, timeout).
  const ApiException.network(String message) : this(0, message);

  final int status;
  final String message;

  /// Seconds until a rate-limited call may be retried (429).
  final int? retryAfterSeconds;

  /// The plan a refusal refers to (`free` / `pro`), when the server says.
  final String? plan;
  final String? requestId;

  bool get isNetwork => status == 0;
  bool get isUnauthorized => status == 401;
  bool get isRateLimited => status == 429;
  bool get isServerError => status >= 500;

  @override
  String toString() => 'ApiException($status): $message';
}

class ApiClient {
  ApiClient({
    required String baseUrl,
    required this._tokens,
    http.Client? client,
    this.timeout = const Duration(seconds: 30),
    this.generateTimeout = const Duration(seconds: 90),
  })  : _base = Uri.parse(baseUrl.replaceAll(RegExp(r'/+$'), '')),
        _http = client ?? http.Client();

  final Uri _base;
  final AuthTokenProvider _tokens;
  final http.Client _http;
  final Duration timeout;

  /// Plan generation calls an LLM and routinely takes longer than the other routes.
  final Duration generateTimeout;

  Uri _uri(String path) => _base.replace(path: '${_base.path}$path');

  Future<http.Response> _once(
    String method,
    Uri uri,
    Map<String, String> headers,
    String? body,
    Duration limit,
  ) async {
    final request = http.Request(method, uri)..headers.addAll(headers);
    if (body != null) request.body = body;
    return http.Response.fromStream(await _http.send(request).timeout(limit));
  }

  Future<Object?> _send(
    String method,
    String path, {
    Object? body,
    bool auth = true,
    Duration? limit,
  }) async {
    final uri = _uri(path);
    final encoded = body == null ? null : jsonEncode(body);
    final lim = limit ?? timeout;

    Map<String, String> headers(String? token) => {
          'Accept': 'application/json',
          if (encoded != null) 'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        };

    try {
      String? token;
      if (auth) {
        token = await _tokens.getAccessToken();
        if (token == null) throw const ApiException(401, 'Not signed in.');
      }
      var response = await _once(method, uri, headers(token), encoded, lim);

      if (auth && response.statusCode == 401) {
        final fresh = await _tokens.refreshAccessToken();
        if (fresh != null) response = await _once(method, uri, headers(fresh), encoded, lim);
      }
      return _decode(response);
    } on TimeoutException {
      throw const ApiException.network('The request timed out. Check your connection and try again.');
    } on SocketException {
      throw const ApiException.network('Could not reach the server. Check your connection and try again.');
    } on http.ClientException {
      throw const ApiException.network('Could not reach the server. Check your connection and try again.');
    }
  }

  Object? _decode(http.Response response) {
    Object? parsed;
    if (response.body.isNotEmpty) {
      try {
        parsed = jsonDecode(utf8.decode(response.bodyBytes));
      } on FormatException {
        parsed = null;
      }
    }
    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (response.statusCode == 204 || response.body.isEmpty) return null;
      if (parsed == null) throw ApiException(response.statusCode, 'Unexpected response from the server.');
      return parsed;
    }
    final map = parsed is Map ? parsed : const {};
    final retry = map['retryAfter'];
    throw ApiException(
      response.statusCode,
      map['error'] is String ? map['error'] as String : 'Request failed (${response.statusCode}).',
      retryAfterSeconds: retry is num ? retry.round() : null,
      plan: map['plan'] is String ? map['plan'] as String : null,
      requestId: map['requestId'] is String ? map['requestId'] as String : response.headers['x-request-id'],
    );
  }

  Map<String, Object?> _object(Object? v) {
    if (v is Map) return v.cast<String, Object?>();
    throw const ApiException(200, 'Unexpected response from the server.');
  }

  // --- Routes ---------------------------------------------------------------------------------------------

  /// `GET /api/subscription`
  Future<SubscriptionInfo> getSubscription() async =>
      SubscriptionInfo.fromJson(_object(await _send('GET', '/api/subscription')));

  /// `POST /api/apple-token`: hands the server the one-time authorization code from Sign in with Apple, so it can keep the token
  /// it needs to revoke Apple's grant when the account is deleted. 503 until the server is set up for it.
  Future<void> linkAppleAuthorization(String authorizationCode) async {
    await _send('POST', '/api/apple-token', body: {'authorizationCode': authorizationCode});
  }

  /// `POST /api/store-purchase`: the App Store transaction id or Google purchase token of a purchase just made (or restored).
  /// The server asks the store what it is and answers with the account's resulting subscription. 403/404/409/422 are final
  /// refusals (not this account's purchase, unknown, already subscribed elsewhere, not Pro); 503 means store billing is
  /// not set up on the server yet.
  Future<SubscriptionInfo> verifyStorePurchase(String platform, String token) async => SubscriptionInfo.fromJson(
      _object(await _send('POST', '/api/store-purchase', body: {'platform': platform, 'token': token})));

  /// `GET /api/ai-config` (no auth): the AI providers the server has keys for.
  Future<List<String>> getEnabledProviders() async {
    final list = _object(await _send('GET', '/api/ai-config', auth: false))['enabledProviders'];
    return list is List ? [for (final p in list) if (p is String) p] : const [];
  }

  /// `GET /api/user-settings`: the provider plan generation will actually use for this account.
  Future<String> getAiProvider() async => _provider(await _send('GET', '/api/user-settings'));

  /// `PUT /api/user-settings`. 402 means a non-default provider needs Pro.
  Future<String> setAiProvider(String provider) async =>
      _provider(await _send('PUT', '/api/user-settings', body: {'aiProvider': provider}));

  String _provider(Object? body) {
    final p = _object(body)['aiProvider'];
    if (p is String) return p;
    throw const ApiException(200, 'Unexpected response from the server.');
  }

  /// `POST /api/generate-plan`. Throws [ApiException]; use [describeGeneratePlanError] for the message to show.
  Future<GeneratedPlan> generatePlan(PlanParams params) async {
    final body = _object(await _send('POST', '/api/generate-plan', body: params.toRequestJson(), limit: generateTimeout));
    final templates = body['templates'];
    if (templates is! Map) throw const ApiException(200, 'Unexpected response from the server.');
    return GeneratedPlan(
      // Same treatment as local data, then tagged as AI-made.
      templates: {
        for (final e in sanitizeTemplates(templates).entries) e.key: e.value.withSource('ai'),
      },
      split: body['split'] is String ? body['split'] as String : null,
      schedule: body['schedule'] is List ? [for (final s in body['schedule'] as List) if (s is String) s] : null,
      progression: body['progression'] is String ? body['progression'] as String : null,
      notes: body['notes'] is String ? body['notes'] as String : null,
    );
  }

  /// `DELETE /api/delete-account`: removes the Stripe customer and the auth account (and so all cloud data). For an account that
  /// signed in with Apple, [appleAuthorizationCode] is a fresh code from Apple's sheet, which the server uses to revoke the account's
  /// Apple access (Apple requires that on deletion).
  Future<void> deleteAccount({String? appleAuthorizationCode}) async {
    await _send('DELETE', '/api/delete-account', body: appleAuthorizationCode == null ? null : {'appleAuthorizationCode': appleAuthorizationCode});
  }

  void close() => _http.close();
}
