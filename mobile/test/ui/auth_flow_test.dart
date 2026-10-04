import 'dart:async';

import 'package:daily_grind/auth/auth_controller.dart';
import 'package:daily_grind/auth/auth_models.dart';
import 'package:daily_grind/ui/auth_gate.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../auth/fake_auth_repository.dart';

/// The auth gate routes between loading, sign-in, password reset and the signed-in app; the forms behind it do the rest.
Widget app(AuthController auth, {void Function(AuthSession)? onBuilt}) => MaterialApp(
      home: AuthGate(
        auth: auth,
        signedIn: (context, session) {
          onBuilt?.call(session);
          return Scaffold(
            body: Column(children: [
              Text('Signed in as ${session.user.displayName}'),
              TextButton(onPressed: auth.signOut, child: const Text('Sign out')),
            ]),
          );
        },
      ),
    );

Future<AuthController> pumpGate(WidgetTester tester, FakeAuthRepository repo, {void Function(AuthSession)? onBuilt}) async {
  final auth = AuthController(repo);
  addTearDown(auth.dispose);
  await tester.pumpWidget(app(auth, onBuilt: onBuilt));
  await auth.start();
  await tester.pumpAndSettle();
  return auth;
}

void main() {
  testWidgets('shows a spinner while the session loads, then the sign-in form', (tester) async {
    final auth = AuthController(FakeAuthRepository());
    addTearDown(auth.dispose);
    await tester.pumpWidget(app(auth));
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await auth.start();
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsWidgets);
    expect(find.byType(TextFormField), findsNWidgets(2));
  });

  group('Sign in with Apple button', () {
    testWidgets('appears on Apple devices, above Google, and starts the Apple sign-in', (tester) async {
      final repo = FakeAuthRepository()..supportsSignInWithApple = true;
      await pumpGate(tester, repo);

      expect(find.text('Continue with Apple'), findsOneWidget);
      expect(find.text('Continue with Google'), findsOneWidget);
      expect(tester.getTopLeft(find.text('Continue with Apple')).dy, lessThan(tester.getTopLeft(find.text('Continue with Google')).dy),
          reason: 'Apple asks for its button to be at least as prominent as any other third-party sign-in');

      await tester.tap(find.text('Continue with Apple'));
      await tester.pumpAndSettle();
      expect(repo.calls, ['apple']);
    });

    testWidgets('is the guideline colour for the theme: black in light mode, white in dark mode', (tester) async {
      Future<Color?> buttonColor(Brightness brightness) async {
        final repo = FakeAuthRepository()..supportsSignInWithApple = true;
        final auth = AuthController(repo);
        addTearDown(auth.dispose);
        await tester.pumpWidget(MaterialApp(
          theme: ThemeData(brightness: brightness, useMaterial3: true),
          home: AuthGate(auth: auth, signedIn: (context, session) => const SizedBox()),
        ));
        await auth.start();
        await tester.pumpAndSettle();
        final button = tester.widget<FilledButton>(find.ancestor(of: find.text('Continue with Apple'), matching: find.byType(FilledButton)));
        return button.style?.backgroundColor?.resolve({});
      }

      expect(await buttonColor(Brightness.light), Colors.black);
      expect(await buttonColor(Brightness.dark), Colors.white);
    });

    testWidgets('is not shown on devices without it, and not while resetting a password', (tester) async {
      final plain = FakeAuthRepository();
      await pumpGate(tester, plain);
      expect(find.text('Continue with Apple'), findsNothing);
      expect(find.text('Continue with Google'), findsOneWidget);

      final apple = FakeAuthRepository()..supportsSignInWithApple = true;
      await pumpGate(tester, apple);
      await tester.tap(find.text('Forgot password?'));
      await tester.pump();
      expect(find.text('Continue with Apple'), findsNothing);
    });

    testWidgets('cannot be pressed twice while a sign-in is running', (tester) async {
      final repo = FakeAuthRepository()
        ..supportsSignInWithApple = true
        ..hold = Completer<void>();
      await pumpGate(tester, repo);
      await tester.tap(find.text('Continue with Apple'));
      await tester.pump();
      expect(tester.widget<FilledButton>(find.ancestor(of: find.text('Continue with Apple'), matching: find.byType(FilledButton))).onPressed, isNull);
      repo.hold!.complete();
      await tester.pumpAndSettle();
    });
  });

  testWidgets('invalid input is caught before anything is sent', (tester) async {
    final repo = FakeAuthRepository();
    await pumpGate(tester, repo);
    await tester.enterText(find.widgetWithText(TextFormField, 'Email'), 'nope');
    await tester.enterText(find.widgetWithText(TextFormField, 'Password'), '123');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pump();
    expect(find.text('Enter a valid email address.'), findsOneWidget);
    expect(find.text('Use at least 6 characters.'), findsOneWidget);
    expect(repo.calls, isEmpty);
  });

  testWidgets('sign-in sends trimmed credentials; a failure shows the message', (tester) async {
    final repo = FakeAuthRepository()..failWith = const AuthFailure('Invalid login credentials');
    await pumpGate(tester, repo);
    await tester.enterText(find.widgetWithText(TextFormField, 'Email'), '  ada@example.com ');
    await tester.enterText(find.widgetWithText(TextFormField, 'Password'), 'secret1');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(repo.calls, ['signIn:ada@example.com:secret1']);
    expect(find.text('Invalid login credentials'), findsOneWidget);
  });

  testWidgets('sign-up tells the user to confirm their email', (tester) async {
    final repo = FakeAuthRepository();
    await pumpGate(tester, repo);
    await tester.tap(find.text('Create an account'));
    await tester.pump();
    await tester.enterText(find.widgetWithText(TextFormField, 'Email'), 'ada@example.com');
    await tester.enterText(find.widgetWithText(TextFormField, 'Password'), 'secret1');
    await tester.tap(find.widgetWithText(FilledButton, 'Create account'));
    await tester.pumpAndSettle();
    expect(repo.calls, ['signUp:ada@example.com:secret1']);
    expect(find.textContaining('Check your email'), findsOneWidget);
  });

  testWidgets('reset needs only an email and never reveals whether the account exists', (tester) async {
    final repo = FakeAuthRepository();
    await pumpGate(tester, repo);
    await tester.tap(find.text('Forgot password?'));
    await tester.pump();
    expect(find.byType(TextFormField), findsOneWidget);
    await tester.enterText(find.byType(TextFormField), 'ada@example.com');
    await tester.tap(find.widgetWithText(FilledButton, 'Reset password'));
    await tester.pumpAndSettle();
    expect(repo.calls, ['reset:ada@example.com']);
    expect(find.textContaining('If that email has an account'), findsOneWidget);
  });

  testWidgets('a signed-in user gets the app; signing out returns to the form', (tester) async {
    final repo = FakeAuthRepository(initial: testSession);
    final built = <AuthSession>[];
    final auth = await pumpGate(tester, repo, onBuilt: built.add);
    expect(find.text('Signed in as Ada'), findsOneWidget);

    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();
    expect(repo.calls, ['signOut']);
    repo.emit(null, AuthEventKind.signedOut);
    await tester.pumpAndSettle();
    expect(auth.isSignedIn, isFalse);
    expect(find.byType(TextFormField), findsNWidgets(2));
  });

  testWidgets('a different account signing in gets a fresh app, not the previous one', (tester) async {
    final repo = FakeAuthRepository(initial: testSession);
    final built = <String>[];
    await pumpGate(tester, repo, onBuilt: (s) => built.add(s.user.id));
    final first = built.length;

    repo.emit(const AuthSession(accessToken: 't2', user: AuthUserProfile(id: 'u2', displayName: 'Bea')), AuthEventKind.signedIn);
    await tester.pumpAndSettle();
    expect(find.text('Signed in as Bea'), findsOneWidget);
    expect(built.length, greaterThan(first));
    expect(built.last, 'u2');
  });

  testWidgets('opening a reset link shows the set-password screen, and saving returns to the app', (tester) async {
    final repo = FakeAuthRepository(initial: testSession);
    final auth = await pumpGate(tester, repo);
    repo.emit(null, AuthEventKind.passwordRecovery);
    await tester.pumpAndSettle();
    expect(find.text('Choose a new password'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField), 'a-new-password');
    await tester.tap(find.text('Save password'));
    await tester.pumpAndSettle();
    expect(repo.calls, ['updatePassword:a-new-password']);
    expect(auth.isPasswordRecovery, isFalse);
    expect(find.text('Signed in as Ada'), findsOneWidget);
  });
}
