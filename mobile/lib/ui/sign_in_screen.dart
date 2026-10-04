import 'package:flutter/material.dart';

import '../auth/auth_controller.dart';

enum _Mode { signIn, signUp, reset }

/// Email/password sign-in, sign-up and password reset, plus Google. Errors come from [AuthController.error].
class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key, required this.auth});

  final AuthController auth;

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  _Mode _mode = _Mode.signIn;
  String? _notice;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _switch(_Mode mode) => setState(() {
        _mode = mode;
        _notice = null;
      });

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    final email = _email.text.trim();
    switch (_mode) {
      case _Mode.signIn:
        try {
          await widget.auth.signInWithEmail(email, _password.text);
        } catch (_) {
          // The controller already holds the message to show.
        }
      case _Mode.signUp:
        try {
          final needsConfirmation = await widget.auth.signUpWithEmail(email, _password.text);
          if (!mounted) return;
          setState(() => _notice = needsConfirmation == true
              ? 'Check your email to confirm your account, then sign in.'
              : null);
        } catch (_) {}
      case _Mode.reset:
        final sent = await widget.auth.resetPassword(email);
        if (!mounted) return;
        setState(() => _notice = sent ? 'If that email has an account, a reset link is on its way.' : null);
    }
  }

  String? _validateEmail(String? v) {
    final value = v?.trim() ?? '';
    return value.contains('@') && value.contains('.') ? null : 'Enter a valid email address.';
  }

  String? _validatePassword(String? v) => (v ?? '').length >= 6 ? null : 'Use at least 6 characters.';

  @override
  Widget build(BuildContext context) {
    final auth = widget.auth;
    final title = switch (_mode) {
      _Mode.signIn => 'Sign in',
      _Mode.signUp => 'Create account',
      _Mode.reset => 'Reset password',
    };
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: ListenableBuilder(
                listenable: auth,
                builder: (context, _) => Form(
                  key: _form,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text('Daily Grind', style: Theme.of(context).textTheme.headlineMedium, textAlign: TextAlign.center),
                      const SizedBox(height: 4),
                      Text(title, style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
                      const SizedBox(height: 24),
                      TextFormField(
                        controller: _email,
                        decoration: const InputDecoration(labelText: 'Email'),
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email],
                        validator: _validateEmail,
                      ),
                      if (_mode != _Mode.reset) ...[
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _password,
                          decoration: const InputDecoration(labelText: 'Password'),
                          obscureText: true,
                          autofillHints: [_mode == _Mode.signUp ? AutofillHints.newPassword : AutofillHints.password],
                          validator: _validatePassword,
                        ),
                      ],
                      const SizedBox(height: 16),
                      if (auth.error != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Text(auth.error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                        ),
                      if (_notice != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_notice!)),
                      FilledButton(
                        onPressed: auth.isWorking ? null : _submit,
                        child: auth.isWorking
                            ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                            : Text(title),
                      ),
                      if (_mode != _Mode.reset) ...[
                        // Apple asks for its button to be at least as prominent as any other third-party sign-in, so it comes first.
                        if (auth.supportsSignInWithApple) ...[
                          const SizedBox(height: 8),
                          _AppleButton(onPressed: auth.isWorking ? null : auth.signInWithApple),
                        ],
                        const SizedBox(height: 8),
                        OutlinedButton(
                          onPressed: auth.isWorking ? null : auth.signInWithGoogle,
                          child: const Text('Continue with Google'),
                        ),
                      ],
                      const SizedBox(height: 8),
                      if (_mode == _Mode.signIn) ...[
                        TextButton(onPressed: () => _switch(_Mode.signUp), child: const Text('Create an account')),
                        TextButton(onPressed: () => _switch(_Mode.reset), child: const Text('Forgot password?')),
                      ] else
                        TextButton(onPressed: () => _switch(_Mode.signIn), child: const Text('Back to sign in')),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// "Continue with Apple", drawn the way Apple's guidelines ask: the Apple logo and the text on solid black in light mode and white
/// in dark mode, the same height as the other buttons.
class _AppleButton extends StatelessWidget {
  const _AppleButton({required this.onPressed});

  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final background = dark ? Colors.white : Colors.black;
    final foreground = dark ? Colors.black : Colors.white;
    return Semantics(
      button: true,
      label: 'Continue with Apple',
      child: ExcludeSemantics(
        child: FilledButton.icon(
          style: FilledButton.styleFrom(backgroundColor: background, foregroundColor: foreground, disabledBackgroundColor: background.withValues(alpha: 0.4)),
          onPressed: onPressed,
          icon: const Icon(Icons.apple, size: 22),
          label: const Text('Continue with Apple'),
        ),
      ),
    );
  }
}
