import 'dart:async';

import 'package:daily_grind/auth/auth_models.dart';

const testSession = AuthSession(
  accessToken: 'tok',
  user: AuthUserProfile(id: 'u1', email: 'a@b.co', displayName: 'Ada'),
);

/// In-memory [AuthRepository]: records calls, lets a test push auth changes and make any action fail.
class FakeAuthRepository implements AuthRepository {
  FakeAuthRepository({this.initial});

  AuthSession? initial;
  Object? failWith;
  bool needsConfirmation = true;
  Completer<void>? hold;
  final calls = <String>[];
  final _changes = StreamController<AuthChange>.broadcast();

  void emit(AuthSession? session, AuthEventKind event) => _changes.add(AuthChange(session, event));

  Future<void> _act(String name) async {
    calls.add(name);
    await hold?.future;
    if (failWith != null) throw failWith!;
  }

  /// Whether the fake device offers Sign in with Apple, and what the "sheet" returns (see [signInWithApple]).
  @override
  bool supportsSignInWithApple = false;

  /// What Apple's sheet returns when asked for a fresh code at account deletion (null = closed).
  String? appleCode;

  @override
  Future<String?> requestAppleAuthorizationCode() async {
    calls.add('appleCode');
    return appleCode;
  }

  @override
  Future<void> signInWithApple() async {
    await _act('apple');
    emit(testSession, AuthEventKind.signedIn);
  }

  @override
  Stream<AuthChange> get changes => _changes.stream;

  @override
  Future<AuthSession?> getSession() async {
    if (failWith is StateError) throw failWith!;
    return initial;
  }

  @override
  Future<void> signInWithEmail(String email, String password) => _act('signIn:$email:$password');

  @override
  Future<bool> signUpWithEmail(String email, String password) async {
    await _act('signUp:$email:$password');
    return needsConfirmation;
  }

  @override
  Future<void> resetPassword(String email) => _act('reset:$email');

  @override
  Future<void> updatePassword(String newPassword) => _act('updatePassword:$newPassword');

  @override
  Future<void> signInWithGoogle() => _act('google');

  @override
  Future<void> signOut() => _act('signOut');
}
