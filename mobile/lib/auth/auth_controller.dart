/// Auth state for the UI; mirror of the web app's `AuthProvider`. Same rules:
///  * a password-recovery event raises a flag and does not itself change the session; the flag clears when the
///    password is updated or a normal sign-in arrives;
///  * every action clears the previous error, and failures are shown, not thrown, except sign-in and sign-up,
///    which also rethrow so the form can react.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import 'auth_models.dart';

class AuthController extends ChangeNotifier {
  AuthController(this._repo);

  final AuthRepository _repo;
  StreamSubscription<AuthChange>? _subscription;
  bool _started = false;
  bool _disposed = false;

  AuthSession? _session;
  String? _error;
  bool _isLoading = true;
  bool _isWorking = false;
  bool _isPasswordRecovery = false;

  AuthSession? get session => _session;
  String? get error => _error;

  /// True until the stored session (if any) has been read.
  bool get isLoading => _isLoading;

  /// True while a sign-in, sign-up, reset or sign-out is in flight.
  bool get isWorking => _isWorking;
  bool get isPasswordRecovery => _isPasswordRecovery;
  bool get isSignedIn => _session != null;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  /// Reads the stored session and starts listening for changes. Safe to call more than once.
  Future<void> start() async {
    if (_started) return;
    _started = true;
    _subscription = _repo.changes.listen((change) {
      if (change.event == AuthEventKind.passwordRecovery) {
        _isPasswordRecovery = true;
        _notify();
        return;
      }
      _session = change.session;
      _error = null;
      _isLoading = false;
      if (change.event == AuthEventKind.signedIn) _isPasswordRecovery = false;
      _notify();
    });
    try {
      _session = await _repo.getSession();
      _error = null;
    } catch (e) {
      _error = _message(e, 'Unable to load auth session.');
    } finally {
      _isLoading = false;
      _notify();
    }
  }

  String _message(Object e, String fallback) => e is AuthFailure && e.message.isNotEmpty ? e.message : fallback;

  Future<T?> _run<T>(Future<T> Function() action, String failure, {bool rethrowError = false}) async {
    _isWorking = true;
    _error = null;
    _notify();
    try {
      return await action();
    } catch (e) {
      _error = _message(e, failure);
      if (rethrowError) rethrow;
      return null;
    } finally {
      _isWorking = false;
      _notify();
    }
  }

  Future<void> signInWithGoogle() => _run(_repo.signInWithGoogle, 'Google sign-in failed.');

  bool get supportsSignInWithApple => _repo.supportsSignInWithApple;

  Future<void> signInWithApple() => _run(_repo.signInWithApple, 'Apple sign-in failed.');

  /// For account deletion: Apple's sheet again, so the server can revoke the account's Apple access. Null if it was closed or could
  /// not be shown; deleting the account never depends on it.
  Future<String?> requestAppleAuthorizationCode() async {
    if (!supportsSignInWithApple) return null;
    try {
      return await _repo.requestAppleAuthorizationCode();
    } catch (_) {
      return null;
    }
  }

  Future<void> signInWithEmail(String email, String password) =>
      _run(() => _repo.signInWithEmail(email, password), 'Sign-in failed.', rethrowError: true);

  /// Returns whether the email must be confirmed before the first sign-in.
  Future<bool?> signUpWithEmail(String email, String password) =>
      _run(() => _repo.signUpWithEmail(email, password), 'Sign-up failed.', rethrowError: true);

  /// Whether the reset email was sent.
  Future<bool> resetPassword(String email) async =>
      await _run(() async {
        await _repo.resetPassword(email);
        return true;
      }, 'Password reset failed.') ??
      false;

  /// Whether the password was changed; on success the recovery screen is done.
  Future<bool> updatePassword(String newPassword) async {
    final ok = await _run(() async {
      await _repo.updatePassword(newPassword);
      return true;
    }, 'Password update failed.');
    if (ok == true) {
      _isPasswordRecovery = false;
      _notify();
    }
    return ok ?? false;
  }

  Future<void> signOut() => _run(_repo.signOut, 'Sign-out failed.');

  @override
  void dispose() {
    _disposed = true;
    _subscription?.cancel();
    super.dispose();
  }
}
