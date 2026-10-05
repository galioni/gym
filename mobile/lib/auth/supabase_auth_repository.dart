/// Supabase implementation of [AuthRepository] and [AuthTokenProvider] (the web app's
/// `SupabaseAuthSessionRepository` / `SupabaseTokenProvider`). Session persistence and token auto-refresh are
/// done by supabase_flutter.
library;

import 'dart:async';

import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import 'apple_sign_in.dart';
import 'auth_models.dart';

String? _metaString(Map<String, dynamic>? meta, String key) {
  final v = meta?[key];
  return v is String ? v : null;
}

/// Maps a Supabase session; the display name prefers `full_name`, then `name`, like the web app.
AuthSession? toAuthSession(sb.Session? session) {
  if (session == null) return null;
  final user = session.user;
  final meta = user.userMetadata;
  final providers = user.appMetadata['providers'];
  return AuthSession(
    accessToken: session.accessToken,
    user: AuthUserProfile(
      id: user.id,
      email: user.email,
      displayName: _metaString(meta, 'full_name') ?? _metaString(meta, 'name'),
      avatarUrl: _metaString(meta, 'avatar_url'),
      providers: providers is List ? [for (final p in providers) if (p is String) p] : const [],
    ),
  );
}

AuthEventKind toEventKind(sb.AuthChangeEvent event) => switch (event) {
      sb.AuthChangeEvent.initialSession => AuthEventKind.initial,
      sb.AuthChangeEvent.signedIn => AuthEventKind.signedIn,
      sb.AuthChangeEvent.signedOut => AuthEventKind.signedOut,
      sb.AuthChangeEvent.tokenRefreshed => AuthEventKind.tokenRefreshed,
      sb.AuthChangeEvent.userUpdated => AuthEventKind.userUpdated,
      sb.AuthChangeEvent.passwordRecovery => AuthEventKind.passwordRecovery,
      _ => AuthEventKind.userUpdated,
    };

class SupabaseAuthRepository implements AuthRepository, AuthTokenProvider {
  SupabaseAuthRepository(
    this._auth, {
    required this.redirectUrl,
    this._apple = const PluginAppleCredentialSource(),
    bool? supportsApple,
    this._random,
  }) : supportsSignInWithApple = supportsApple ?? (!kIsWeb && (defaultTargetPlatform == TargetPlatform.iOS || defaultTargetPlatform == TargetPlatform.macOS));

  final sb.GoTrueClient _auth;
  final AppleCredentialSource _apple;
  final Random? _random;

  @override
  final bool supportsSignInWithApple;

  /// Told the one-time authorization code after each Apple sign-in, so the server can keep the token it needs to revoke Apple's
  /// grant when the account is deleted. Set once the API client exists. Its failure never fails the sign-in.
  Future<void> Function(String authorizationCode)? onAppleAuthorization;

  /// Where Supabase sends the user back to (deep link into this app).
  final String redirectUrl;

  Future<T> _guard<T>(Future<T> Function() body) async {
    try {
      return await body();
    } on sb.AuthException catch (e) {
      throw AuthFailure(e.message);
    }
  }

  @override
  Future<AuthSession?> getSession() async => toAuthSession(_auth.currentSession);

  @override
  Future<void> signInWithEmail(String email, String password) =>
      _guard(() => _auth.signInWithPassword(email: email, password: password));

  @override
  Future<bool> signUpWithEmail(String email, String password) => _guard(() async {
        final response = await _auth.signUp(email: email, password: password, emailRedirectTo: redirectUrl);
        return response.session == null;
      });

  @override
  Future<void> resetPassword(String email) => _guard(() => _auth.resetPasswordForEmail(email, redirectTo: redirectUrl));

  @override
  Future<void> updatePassword(String newPassword) =>
      _guard(() => _auth.updateUser(sb.UserAttributes(password: newPassword)));

  @override
  Future<void> signInWithGoogle() => _guard(
        () => _auth.signInWithOAuth(
          sb.OAuthProvider.google,
          redirectTo: redirectUrl,
          authScreenLaunchMode: sb.LaunchMode.externalApplication,
        ),
      );

  @override
  Future<void> signInWithApple() => _guard(() async {
        // A fresh one-time value: Apple puts its hash in the identity token, Supabase checks it against the original.
        final nonce = generateRawNonce(_random);
        final credential = await _apple.request(hashedNonce: sha256Hex(nonce));
        if (credential == null) return; // the person closed the sheet

        await _auth.signInWithIdToken(provider: sb.OAuthProvider.apple, idToken: credential.idToken, nonce: nonce);

        // Apple tells us the name once, the first time. Keep it, so the account shows a name instead of an email.
        final name = credential.fullName;
        if (name.isNotEmpty && _auth.currentUser?.userMetadata?['full_name'] == null) {
          try {
            await _auth.updateUser(sb.UserAttributes(data: {'full_name': name}));
          } on sb.AuthException {
            // Cosmetic: the account works without it.
          }
        }

        final report = onAppleAuthorization;
        if (report != null && credential.authorizationCode.isNotEmpty) {
          try {
            await report(credential.authorizationCode);
          } catch (_) {
            // The server may not have Sign in with Apple set up (or be unreachable). Signing in must not depend on it.
          }
        }
      });

  @override
  Future<String?> requestAppleAuthorizationCode() async {
    final credential = await _apple.request(hashedNonce: sha256Hex(generateRawNonce(_random)));
    final code = credential?.authorizationCode;
    return code == null || code.isEmpty ? null : code;
  }

  @override
  Future<void> signOut() => _guard(_auth.signOut);

  @override
  Stream<AuthChange> get changes =>
      _auth.onAuthStateChange.map((s) => AuthChange(toAuthSession(s.session), toEventKind(s.event)));

  @override
  Future<String?> getAccessToken() async {
    final session = _auth.currentSession;
    if (session == null) return null;
    if (!session.isExpired) return session.accessToken;
    return refreshAccessToken();
  }

  @override
  Future<String?> refreshAccessToken() async {
    if (_auth.currentSession == null) return null;
    try {
      return (await _auth.refreshSession()).session?.accessToken;
    } on sb.AuthException {
      return null;
    }
  }
}
