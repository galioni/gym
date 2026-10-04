/// Authentication boundary, mirroring `interfaces/auth/*` in the web app.
library;

class AuthUserProfile {
  const AuthUserProfile({required this.id, this.email, this.displayName, this.avatarUrl, this.providers = const []});

  final String id;
  final String? email;
  final String? displayName;
  final String? avatarUrl;

  /// How the account can sign in: `email` (a password), `google`, `apple`.
  final List<String> providers;

  bool get usesApple => providers.contains('apple');

  /// Whether a password exists, so the account can sign in with email and password (for example on the website).
  bool get hasPassword => providers.contains('email');
}

class AuthSession {
  const AuthSession({required this.accessToken, required this.user});

  final String accessToken;
  final AuthUserProfile user;
}

/// What an auth state change was. Only [passwordRecovery] needs special handling (show the set-password
/// screen instead of the app); the rest just carry the new session.
enum AuthEventKind { initial, signedIn, signedOut, tokenRefreshed, userUpdated, passwordRecovery }

class AuthChange {
  const AuthChange(this.session, this.event);

  final AuthSession? session;
  final AuthEventKind event;
}

/// A sign-in, sign-up or password problem with a message that is safe to show the user.
class AuthFailure implements Exception {
  const AuthFailure(this.message);

  final String message;

  @override
  String toString() => message;
}

abstract interface class AuthRepository {
  Future<AuthSession?> getSession();
  Future<void> signInWithGoogle();

  /// Whether this device offers Sign in with Apple (iOS and macOS). Apple requires it next to any other third-party sign-in.
  bool get supportsSignInWithApple;

  /// Apple's native sheet, then a Supabase session from the identity token. Returns normally, without a session, if the person
  /// closes the sheet.
  Future<void> signInWithApple();

  /// A fresh one-time code from Apple's sheet, for the server to revoke the account's Apple access when it is deleted (Apple
  /// requires that). Null when the person closes the sheet or this device cannot show it.
  Future<String?> requestAppleAuthorizationCode();
  Future<void> signInWithEmail(String email, String password);

  /// True when the account exists but the email must be confirmed before a session is issued.
  Future<bool> signUpWithEmail(String email, String password);
  Future<void> resetPassword(String email);
  Future<void> updatePassword(String newPassword);
  Future<void> signOut();
  Stream<AuthChange> get changes;
}

/// Supplies bearer tokens to the API client.
abstract interface class AuthTokenProvider {
  /// A token that is valid now, refreshed first if it has expired; null when signed out.
  Future<String?> getAccessToken();

  /// Forces a refresh (after the server rejected a token). Null when there is no session to refresh.
  Future<String?> refreshAccessToken();
}
