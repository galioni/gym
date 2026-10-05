import 'package:daily_grind/auth/auth_models.dart';
import 'package:daily_grind/auth/supabase_auth_repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

sb.Session session({Map<String, dynamic>? meta, String? email = 'a@b.co', Map<String, dynamic> appMeta = const {}}) => sb.Session(
      accessToken: 'jwt',
      tokenType: 'bearer',
      user: sb.User(
        id: 'u1',
        appMetadata: appMeta,
        userMetadata: meta,
        aud: 'authenticated',
        email: email,
        createdAt: '2026-10-01T00:00:00Z',
      ),
    );

void main() {
  group('toAuthSession', () {
    test('null stays null', () => expect(toAuthSession(null), isNull));

    test('maps the token and user', () {
      final s = toAuthSession(session(meta: {'full_name': 'Ada Lovelace', 'name': 'ignored', 'avatar_url': 'https://x/a.png'}))!;
      expect(s.accessToken, 'jwt');
      expect([s.user.id, s.user.email, s.user.displayName, s.user.avatarUrl], ['u1', 'a@b.co', 'Ada Lovelace', 'https://x/a.png']);
    });

    test('falls back from full_name to name, then to nothing', () {
      expect(toAuthSession(session(meta: {'name': 'Ada'}))!.user.displayName, 'Ada');
      expect(toAuthSession(session(meta: {'full_name': 7}))!.user.displayName, isNull);
      expect(toAuthSession(session())!.user.displayName, isNull);
    });

    test('a missing email is null', () => expect(toAuthSession(session(email: null))!.user.email, isNull));

    test('reads how the account signs in', () {
      final apple = toAuthSession(session(appMeta: {'provider': 'apple', 'providers': ['apple']}))!.user;
      expect([apple.providers, apple.usesApple, apple.hasPassword], [['apple'], true, false]);
      final both = toAuthSession(session(appMeta: {'providers': ['apple', 'email', 7]}))!.user;
      expect([both.providers, both.usesApple, both.hasPassword], [['apple', 'email'], true, true]);
      expect(toAuthSession(session())!.user.providers, isEmpty);
    });
  });

  test('every Supabase event maps to a kind, unknown ones to userUpdated', () {
    expect(toEventKind(sb.AuthChangeEvent.initialSession), AuthEventKind.initial);
    expect(toEventKind(sb.AuthChangeEvent.signedIn), AuthEventKind.signedIn);
    expect(toEventKind(sb.AuthChangeEvent.signedOut), AuthEventKind.signedOut);
    expect(toEventKind(sb.AuthChangeEvent.tokenRefreshed), AuthEventKind.tokenRefreshed);
    expect(toEventKind(sb.AuthChangeEvent.userUpdated), AuthEventKind.userUpdated);
    expect(toEventKind(sb.AuthChangeEvent.passwordRecovery), AuthEventKind.passwordRecovery);
    expect(toEventKind(sb.AuthChangeEvent.mfaChallengeVerified), AuthEventKind.userUpdated);
  });
}
