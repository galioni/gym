import 'dart:async';

import 'package:daily_grind/auth/auth_controller.dart';
import 'package:daily_grind/auth/auth_models.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_auth_repository.dart';

Future<void> settle() => Future<void>.delayed(Duration.zero);

void main() {
  late FakeAuthRepository repo;
  late AuthController auth;

  setUp(() {
    repo = FakeAuthRepository();
    auth = AuthController(repo);
  });
  tearDown(() => auth.dispose());

  group('start', () {
    test('is loading until the stored session is read, then signed out', () async {
      expect(auth.isLoading, isTrue);
      await auth.start();
      expect([auth.isLoading, auth.isSignedIn, auth.error], [false, false, null]);
    });

    test('restores a stored session', () async {
      repo.initial = testSession;
      await auth.start();
      expect(auth.session, testSession);
    });

    test('a failure to read the session is reported and loading ends', () async {
      repo.failWith = StateError('disk');
      await auth.start();
      expect([auth.isLoading, auth.error], [false, 'Unable to load auth session.']);
    });

    test('calling start twice listens once', () async {
      await auth.start();
      await auth.start();
      var notifications = 0;
      auth.addListener(() => notifications++);
      repo.emit(testSession, AuthEventKind.signedIn);
      await settle();
      expect(notifications, 1);
    });
  });

  group('auth changes', () {
    setUp(() async => auth.start());

    test('a sign-in event sets the session and clears errors', () async {
      repo.failWith = const AuthFailure('bad');
      await auth.signInWithEmail('a@b.co', 'x').catchError((_) {});
      expect(auth.error, 'bad');
      repo.emit(testSession, AuthEventKind.signedIn);
      await settle();
      expect([auth.session, auth.error], [testSession, null]);
    });

    test('sign-out and token refresh update the session', () async {
      repo.emit(testSession, AuthEventKind.signedIn);
      await settle();
      repo.emit(const AuthSession(accessToken: 'new', user: AuthUserProfile(id: 'u1')), AuthEventKind.tokenRefreshed);
      await settle();
      expect(auth.session!.accessToken, 'new');
      repo.emit(null, AuthEventKind.signedOut);
      await settle();
      expect(auth.isSignedIn, isFalse);
    });

    test('password recovery raises a flag without touching the session', () async {
      repo.emit(testSession, AuthEventKind.signedIn);
      await settle();
      repo.emit(null, AuthEventKind.passwordRecovery);
      await settle();
      expect([auth.isPasswordRecovery, auth.session], [true, testSession]);
    });

    test('a later normal sign-in clears the recovery flag', () async {
      repo.emit(null, AuthEventKind.passwordRecovery);
      await settle();
      repo.emit(testSession, AuthEventKind.signedIn);
      await settle();
      expect(auth.isPasswordRecovery, isFalse);
    });
  });

  group('actions', () {
    setUp(() async => auth.start());

    test('sign-in passes credentials through and shows busy state while running', () async {
      repo.hold = Completer<void>();
      final done = auth.signInWithEmail('a@b.co', 'secret');
      expect(auth.isWorking, isTrue);
      repo.hold!.complete();
      await done;
      expect([auth.isWorking, repo.calls], [false, ['signIn:a@b.co:secret']]);
    });

    test('sign-in failure shows the message and rethrows for the form', () async {
      repo.failWith = const AuthFailure('Invalid login credentials');
      await expectLater(auth.signInWithEmail('a@b.co', 'x'), throwsA(isA<AuthFailure>()));
      expect([auth.error, auth.isWorking], ['Invalid login credentials', false]);
    });

    test('an unexpected failure shows the generic message, never the raw error', () async {
      repo.failWith = StateError('secret internals');
      await expectLater(auth.signInWithEmail('a@b.co', 'x'), throwsStateError);
      expect(auth.error, 'Sign-in failed.');
    });

    test('sign-up reports whether confirmation is needed', () async {
      expect(await auth.signUpWithEmail('a@b.co', 'secret1'), isTrue);
      repo.needsConfirmation = false;
      expect(await auth.signUpWithEmail('a@b.co', 'secret1'), isFalse);
    });

    test('sign-up failure rethrows with the message', () async {
      repo.failWith = const AuthFailure('User already registered');
      await expectLater(auth.signUpWithEmail('a@b.co', 'secret1'), throwsA(isA<AuthFailure>()));
      expect(auth.error, 'User already registered');
    });

    test('reset password returns whether it was sent and does not throw', () async {
      expect(await auth.resetPassword('a@b.co'), isTrue);
      repo.failWith = const AuthFailure('rate limited');
      expect(await auth.resetPassword('a@b.co'), isFalse);
      expect(auth.error, 'rate limited');
    });

    test('updating the password ends recovery; a failure keeps it', () async {
      repo.emit(null, AuthEventKind.passwordRecovery);
      await settle();
      repo.failWith = const AuthFailure('too weak');
      expect(await auth.updatePassword('x'), isFalse);
      expect([auth.isPasswordRecovery, auth.error], [true, 'too weak']);
      repo.failWith = null;
      expect(await auth.updatePassword('a-good-one'), isTrue);
      expect([auth.isPasswordRecovery, auth.error], [false, null]);
    });

    test('google and sign-out failures are shown, not thrown', () async {
      repo.failWith = const AuthFailure('');
      await auth.signInWithGoogle();
      expect(auth.error, 'Google sign-in failed.');
      await auth.signOut();
      expect(auth.error, 'Sign-out failed.');
    });

    test('Sign in with Apple: offered only where the device has it, and a failure is shown, not thrown', () async {
      expect(auth.supportsSignInWithApple, isFalse);
      repo.supportsSignInWithApple = true;
      expect(auth.supportsSignInWithApple, isTrue);

      repo.failWith = const AuthFailure('');
      await auth.signInWithApple();
      expect(auth.error, 'Apple sign-in failed.');

      repo.failWith = null;
      await auth.signInWithApple();
      expect(auth.error, isNull);
      expect(repo.calls, contains('apple'));
    });

    test('the fresh Apple code for account deletion: only where Apple sign-in exists, and never an error', () async {
      repo.appleCode = 'fresh';
      expect(await auth.requestAppleAuthorizationCode(), isNull, reason: 'this device has no Apple sign-in');
      expect(repo.calls, isNot(contains('appleCode')));

      repo.supportsSignInWithApple = true;
      expect(await auth.requestAppleAuthorizationCode(), 'fresh');
      repo.appleCode = null;
      expect(await auth.requestAppleAuthorizationCode(), isNull, reason: 'the sheet was closed');
      expect(auth.error, isNull);
    });

    test('each action clears the previous error', () async {
      repo.failWith = const AuthFailure('first');
      await auth.signOut();
      expect(auth.error, 'first');
      repo.failWith = null;
      await auth.signOut();
      expect(auth.error, isNull);
    });
  });

  test('events after dispose are ignored', () async {
    await auth.start();
    auth.dispose();
    repo.emit(testSession, AuthEventKind.signedIn);
    await settle();
    // tearDown disposes again: ChangeNotifier tolerates only one dispose, so recreate for it.
    auth = AuthController(repo);
  });
}
