/// Getting an identity from Apple's own sign-in sheet (the sign_in_with_apple plugin) behind a small interface, so the rest of the
/// app, and the tests, never touch the plugin.
library;

import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import 'auth_models.dart';

/// What Apple hands back after the person approves.
class AppleCredential {
  const AppleCredential({required this.idToken, required this.authorizationCode, this.givenName, this.familyName});

  /// Proves who the person is to Supabase. Carries the hash of the nonce we sent.
  final String idToken;

  /// One-time code the server trades for a refresh token, kept only so the token can be revoked when the account is deleted.
  final String authorizationCode;

  /// Apple gives the name only the first time a person authorises an app.
  final String? givenName;
  final String? familyName;

  String get fullName => [givenName, familyName].whereType<String>().map((s) => s.trim()).where((s) => s.isNotEmpty).join(' ');
}

abstract interface class AppleCredentialSource {
  /// Shows Apple's sheet. Null when the person closes it without choosing. Throws [AuthFailure] when Apple reports a failure.
  Future<AppleCredential?> request({required String hashedNonce});
}

class PluginAppleCredentialSource implements AppleCredentialSource {
  const PluginAppleCredentialSource();

  @override
  Future<AppleCredential?> request({required String hashedNonce}) async {
    try {
      final credential = await SignInWithApple.getAppleIDCredential(
        scopes: [AppleIDAuthorizationScopes.email, AppleIDAuthorizationScopes.fullName],
        nonce: hashedNonce,
      );
      final idToken = credential.identityToken;
      if (idToken == null || idToken.isEmpty) throw const AuthFailure('Apple sign-in failed.');
      return AppleCredential(
        idToken: idToken,
        authorizationCode: credential.authorizationCode,
        givenName: credential.givenName,
        familyName: credential.familyName,
      );
    } on SignInWithAppleAuthorizationException catch (e) {
      if (e.code == AuthorizationErrorCode.canceled) return null;
      throw const AuthFailure('Apple sign-in failed.');
    } on SignInWithAppleException {
      throw const AuthFailure('Apple sign-in failed.');
    }
  }
}

const _nonceChars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._';

/// A random one-time string. Its hash goes to Apple and the string itself to Supabase, which checks they match: a stolen identity
/// token cannot be replayed.
String generateRawNonce([Random? random, int length = 32]) {
  final r = random ?? Random.secure();
  return List.generate(length, (_) => _nonceChars[r.nextInt(_nonceChars.length)]).join();
}

String sha256Hex(String input) => sha256.convert(utf8.encode(input)).toString();
