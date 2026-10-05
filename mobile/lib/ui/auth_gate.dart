import 'package:flutter/material.dart';

import '../auth/auth_controller.dart';
import '../auth/auth_models.dart';
import 'set_password_screen.dart';
import 'sign_in_screen.dart';

/// Chooses the screen from the auth state: loading, set-new-password, sign-in, or the app (built by [signedIn]).
class AuthGate extends StatelessWidget {
  const AuthGate({super.key, required this.auth, required this.signedIn});

  final AuthController auth;
  final Widget Function(BuildContext context, AuthSession session) signedIn;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: auth,
        builder: (context, _) {
          if (auth.isLoading) return const Scaffold(body: Center(child: CircularProgressIndicator()));
          if (auth.isPasswordRecovery && auth.session != null) return SetPasswordScreen(auth: auth);
          final session = auth.session;
          if (session == null) return SignInScreen(auth: auth);
          return KeyedSubtree(key: ValueKey(session.user.id), child: signedIn(context, session));
        },
      );
}
