import 'dart:convert';
import 'dart:math';

import 'package:daily_grind/auth/apple_sign_in.dart';
import 'package:daily_grind/auth/auth_models.dart';
import 'package:daily_grind/auth/supabase_auth_repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

/// What Apple's sheet would return, recording what it was asked.
class FakeAppleSource implements AppleCredentialSource {
  FakeAppleSource(this.credential, {this.failWith});

  AppleCredential? credential;
  Object? failWith;
  final hashedNonces = <String>[];

  @override
  Future<AppleCredential?> request({required String hashedNonce}) async {
    hashedNonces.add(hashedNonce);
    if (failWith != null) throw failWith!;
    return credential;
  }
}

String _jwt() {
  String part(Map<String, Object?> m) => base64Url.encode(utf8.encode(jsonEncode(m))).replaceAll('=', '');
  final exp = DateTime.now().add(const Duration(hours: 1)).millisecondsSinceEpoch ~/ 1000;
  return '${part({'alg': 'HS256', 'typ': 'JWT'})}.${part({'sub': 'u1', 'exp': exp, 'role': 'authenticated'})}.sig';
}

Map<String, Object?> _user({Map<String, Object?> meta = const {}}) => {
      'id': 'u1',
      'aud': 'authenticated',
      'email': 'a@privaterelay.appleid.com',
      'app_metadata': {'provider': 'apple'},
      'user_metadata': meta,
      'created_at': '2026-10-04T00:00:00Z',
    };

http.Response _json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

class Rig {
  Rig({AppleCredential? credential, Object? sourceFails, this.existingMeta = const {}, bool supportsApple = true, this.signInStatus = 200}) {
    source = FakeAppleSource(credential, failWith: sourceFails);
    final client = MockClient((request) async {
      requests.add(request);
      final path = request.url.path;
      if (path.endsWith('/token')) {
        if (signInStatus != 200) return _json({'error': 'invalid_grant', 'error_description': 'Nonces mismatch'}, signInStatus);
        return _json({'access_token': _jwt(), 'token_type': 'bearer', 'expires_in': 3600, 'refresh_token': 'r', 'user': _user(meta: existingMeta)});
      }
      if (path.endsWith('/user') && request.method == 'PUT') {
        return _json(_user(meta: {...existingMeta, ...(jsonDecode(request.body)['data'] as Map).cast<String, Object?>()}));
      }
      return _json({'error': 'unexpected ${request.method} $path'}, 404);
    });
    auth = sb.GoTrueClient(url: 'https://x.supabase.co/auth/v1', headers: {'apikey': 'anon'}, httpClient: client);
    repo = SupabaseAuthRepository(auth, redirectUrl: 'com.dailygrind.app://login-callback', apple: source, supportsApple: supportsApple, random: Random(7));
  }

  final Map<String, Object?> existingMeta;
  final int signInStatus;
  late final FakeAppleSource source;
  late final sb.GoTrueClient auth;
  late final SupabaseAuthRepository repo;
  final requests = <http.Request>[];

  Iterable<http.Request> get tokenCalls => requests.where((r) => r.url.path.endsWith('/token'));
  Iterable<http.Request> get nameCalls => requests.where((r) => r.url.path.endsWith('/user'));
}

const _credential = AppleCredential(idToken: 'apple.identity.token', authorizationCode: 'one-time-code', givenName: 'Ada', familyName: 'Lovelace');

void main() {
  group('nonce', () {
    test('is random, long, and uses only characters Apple accepts', () {
      final a = generateRawNonce();
      final b = generateRawNonce();
      expect(a, hasLength(32));
      expect(a, matches(RegExp(r'^[0-9A-Za-z\-._]+$')));
      expect(a, isNot(b));
    });

    test('is hashed with SHA-256 as lower-case hex', () {
      expect(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
  });

  test('the full name is made of what Apple gave, or empty', () {
    expect(_credential.fullName, 'Ada Lovelace');
    expect(const AppleCredential(idToken: 't', authorizationCode: 'c', givenName: 'Ada').fullName, 'Ada');
    expect(const AppleCredential(idToken: 't', authorizationCode: 'c').fullName, '');
    expect(const AppleCredential(idToken: 't', authorizationCode: 'c', givenName: ' ', familyName: '').fullName, '');
  });

  group('SupabaseAuthRepository.signInWithApple', () {
    test('sends Apple the HASH of a nonce and Supabase the nonce itself, with the identity token', () async {
      final r = Rig(credential: _credential);
      await r.repo.signInWithApple();

      final body = jsonDecode(r.tokenCalls.single.body) as Map<String, dynamic>;
      expect(r.tokenCalls.single.url.queryParameters['grant_type'], 'id_token');
      expect(body['provider'], 'apple');
      expect(body['id_token'], 'apple.identity.token');
      final rawNonce = body['nonce'] as String;
      expect(rawNonce, hasLength(32));
      expect(r.source.hashedNonces.single, sha256Hex(rawNonce), reason: 'Apple embeds the hash in the token; Supabase checks it against the nonce');
      expect(r.source.hashedNonces.single, isNot(rawNonce));
      expect(r.auth.currentSession, isNotNull);
    });

    test('a different nonce every time', () async {
      final r = Rig(credential: _credential);
      await r.repo.signInWithApple();
      await r.repo.signInWithApple();
      expect(r.source.hashedNonces.toSet(), hasLength(2));
    });

    test('closing the sheet is not an error and signs nobody in', () async {
      final r = Rig(credential: null);
      await r.repo.signInWithApple();
      expect(r.requests, isEmpty);
      expect(r.auth.currentSession, isNull);
    });

    test('saves the name Apple gave on first sign-in, and leaves an existing name alone', () async {
      final first = Rig(credential: _credential);
      await first.repo.signInWithApple();
      expect(jsonDecode(first.nameCalls.single.body), {'data': {'full_name': 'Ada Lovelace'}});

      final again = Rig(credential: _credential, existingMeta: {'full_name': 'Already Set'});
      await again.repo.signInWithApple();
      expect(again.nameCalls, isEmpty);

      // Apple sends no name after the first time: nothing to save.
      final later = Rig(credential: const AppleCredential(idToken: 't', authorizationCode: 'c'));
      await later.repo.signInWithApple();
      expect(later.nameCalls, isEmpty);
    });

    test('hands the authorization code to the server so it can revoke Apple\'s grant when the account is deleted', () async {
      final r = Rig(credential: _credential);
      final codes = <String>[];
      r.repo.onAppleAuthorization = (code) async => codes.add(code);
      await r.repo.signInWithApple();
      expect(codes, ['one-time-code']);
    });

    test('a failure of that call never fails the sign-in (the server may not be set up for it)', () async {
      final r = Rig(credential: _credential);
      r.repo.onAppleAuthorization = (_) async => throw Exception('503');
      await r.repo.signInWithApple();
      expect(r.auth.currentSession, isNotNull);
    });

    test('Supabase refusing the token is reported as a sign-in failure with its message', () async {
      final r = Rig(credential: _credential, signInStatus: 400);
      await expectLater(r.repo.signInWithApple(), throwsA(isA<AuthFailure>().having((e) => e.message, 'message', contains('Nonces mismatch'))));
    });

    test('a failure reported by Apple passes through', () async {
      final r = Rig(sourceFails: const AuthFailure('Apple sign-in failed.'));
      await expectLater(r.repo.signInWithApple(), throwsA(isA<AuthFailure>()));
      expect(r.requests, isEmpty);
    });

    test('asks Apple again for a fresh code for account deletion, signing nobody in', () async {
      final r = Rig(credential: _credential);
      expect(await r.repo.requestAppleAuthorizationCode(), 'one-time-code');
      expect(r.source.hashedNonces, hasLength(1));
      expect(r.requests, isEmpty, reason: 'only Apple is asked; Supabase is not touched');
    });

    test('gives no code when the sheet is closed or Apple returns an empty one', () async {
      expect(await Rig(credential: null).repo.requestAppleAuthorizationCode(), isNull);
      expect(await Rig(credential: const AppleCredential(idToken: 't', authorizationCode: '')).repo.requestAppleAuthorizationCode(), isNull);
    });

    test('is offered on Apple platforms only', () {
      expect(Rig(supportsApple: true).repo.supportsSignInWithApple, isTrue);
      expect(Rig(supportsApple: false).repo.supportsSignInWithApple, isFalse);
      // The test host reports Android, so the default is off.
      final plain = SupabaseAuthRepository(Rig().auth, redirectUrl: 'x://y');
      expect(plain.supportsSignInWithApple, isFalse);
    });
  });
}
