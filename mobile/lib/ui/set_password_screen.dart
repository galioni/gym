import 'package:flutter/material.dart';

import '../auth/auth_controller.dart';

/// Shown after the user opens a password-reset link: they have a recovery session and choose a new password.
class SetPasswordScreen extends StatefulWidget {
  const SetPasswordScreen({super.key, required this.auth});

  final AuthController auth;

  @override
  State<SetPasswordScreen> createState() => _SetPasswordScreenState();
}

class _SetPasswordScreenState extends State<SetPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _password = TextEditingController();

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = widget.auth;
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
                      Text('Choose a new password', style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
                      const SizedBox(height: 24),
                      TextFormField(
                        controller: _password,
                        decoration: const InputDecoration(labelText: 'New password'),
                        obscureText: true,
                        autofillHints: const [AutofillHints.newPassword],
                        validator: (v) => (v ?? '').length >= 6 ? null : 'Use at least 6 characters.',
                      ),
                      const SizedBox(height: 16),
                      if (auth.error != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Text(auth.error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                        ),
                      FilledButton(
                        onPressed: auth.isWorking
                            ? null
                            : () {
                                if (_form.currentState!.validate()) auth.updatePassword(_password.text);
                              },
                        child: const Text('Save password'),
                      ),
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
