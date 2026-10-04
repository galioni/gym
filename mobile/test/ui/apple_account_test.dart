import 'package:daily_grind/auth/auth_models.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/sync_device.dart' show mkDay;

const appleSession = AuthSession(
  accessToken: 'tok',
  user: AuthUserProfile(id: 'u1', email: 'x1y2@privaterelay.appleid.com', displayName: 'Ada', providers: ['apple']),
);

const emailSession = AuthSession(
  accessToken: 'tok',
  user: AuthUserProfile(id: 'u1', email: 'a@b.co', displayName: 'Ada', providers: ['email']),
);

Future<void> seed(dynamic s) async {
  await s.templateRepo.writeTemplates({'tennis': const TemplateData(main: [TemplateRow(id: 't', text: 'Rally')])});
  await s.workoutRepo.saveDay(mkDay('2026-10-03', 'notes'));
}

Future<void> scrollToText(WidgetTester tester, String text) async {
  await tester.scrollUntilVisible(find.text(text), 200, scrollable: find.byType(Scrollable).first);
  await tester.pumpAndSettle();
}

Future<Harness> open(WidgetTester tester, AuthSession session, {bool appleDevice = true, String? appleCode}) async {
  final h = await pumpDashboard(tester, seed: seed, session: session);
  h.authRepo
    ..supportsSignInWithApple = appleDevice
    ..appleCode = appleCode;
  await h.openSettings(tester);
  return h;
}

void main() {
  group('the account card', () {
    uiTest('shows the name and, under it, the address the account signs in with', (tester) async {
      await open(tester, emailSession);
      expect(find.text('Ada'), findsOneWidget);
      expect(find.text('a@b.co'), findsOneWidget);
      expect(find.text('Set a password'), findsNothing, reason: 'it already has one');
    });

    uiTest('an Apple account is told how to use the website, with its (possibly hidden) address', (tester) async {
      await open(tester, appleSession);
      expect(find.text('x1y2@privaterelay.appleid.com'), findsOneWidget);
      expect(find.textContaining('To use this account on the website too, set a password'), findsOneWidget);
      expect(find.textContaining('x1y2@privaterelay.appleid.com and that password'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Set a password'), findsOneWidget);
    });

    uiTest('an Apple account that also has a password is not nagged', (tester) async {
      await open(tester, const AuthSession(accessToken: 't', user: AuthUserProfile(id: 'u1', email: 'a@b.co', providers: ['apple', 'email'])));
      expect(find.text('Set a password'), findsNothing);
    });
  });

  group('setting a password', () {
    uiTest('asks for one of at least 6 characters, sets it, and says what to use on the website', (tester) async {
      final h = await open(tester, appleSession);
      await tester.tap(find.widgetWithText(OutlinedButton, 'Set a password'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextFormField), '123');
      await tester.tap(find.widgetWithText(FilledButton, 'Set password'));
      await tester.pump();
      expect(find.text('Use at least 6 characters.'), findsOneWidget);
      expect(h.authRepo.calls.where((c) => c.startsWith('updatePassword')), isEmpty);

      await tester.enterText(find.byType(TextFormField), 'a-good-one');
      await tester.tap(find.widgetWithText(FilledButton, 'Set password'));
      await tester.pumpAndSettle();
      expect(h.authRepo.calls, contains('updatePassword:a-good-one'));
      expect(find.text('Password set'), findsOneWidget);
      expect(find.text('On the website, sign in with x1y2@privaterelay.appleid.com and this password.'), findsOneWidget);
    });

    uiTest('cancelling sets nothing', (tester) async {
      final h = await open(tester, appleSession);
      await tester.tap(find.widgetWithText(OutlinedButton, 'Set a password'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(h.authRepo.calls.where((c) => c.startsWith('updatePassword')), isEmpty);
    });
  });

  group('deleting an account that signed in with Apple', () {
    Future<void> deleteIt(WidgetTester tester) async {
      await scrollToText(tester, 'Delete account and all data');
      await tester.tap(find.widgetWithText(FilledButton, 'Delete account and all data'));
      await tester.pumpAndSettle();
      await confirmDangerous(tester, 'Delete everything');
    }

    uiTest('warns that Apple will be asked, then sends the fresh code so the server can revoke Apple\'s access', (tester) async {
      final h = await open(tester, appleSession, appleCode: 'fresh-code');
      await scrollToText(tester, 'Delete account and all data');
      await tester.tap(find.widgetWithText(FilledButton, 'Delete account and all data'));
      await tester.pumpAndSettle();
      expect(find.textContaining('asked to confirm with Apple'), findsOneWidget);
      await confirmDangerous(tester, 'Delete everything');

      expect(h.authRepo.calls, contains('appleCode'));
      expect(h.api.deleteCodes, ['fresh-code']);
      expect(h.authRepo.calls, contains('signOut'));
    });

    uiTest('closing Apple\'s sheet does not stop the deletion (the stored token is the fallback)', (tester) async {
      final h = await open(tester, appleSession, appleCode: null);
      await deleteIt(tester);
      expect(h.api.deleteCalls, 1);
      expect(h.api.deleteCodes, [null]);
      expect(h.authRepo.calls, contains('signOut'));
    });

    uiTest('a device without Apple sign-in does not show a sheet, and does not mention it', (tester) async {
      final h = await open(tester, appleSession, appleDevice: false, appleCode: 'unused');
      await scrollToText(tester, 'Delete account and all data');
      await tester.tap(find.widgetWithText(FilledButton, 'Delete account and all data'));
      await tester.pumpAndSettle();
      expect(find.textContaining('confirm with Apple'), findsNothing);
      await confirmDangerous(tester, 'Delete everything');
      expect(h.authRepo.calls, isNot(contains('appleCode')));
      expect(h.api.deleteCodes, [null]);
    });

    uiTest('an account that never used Apple is not asked anything extra', (tester) async {
      final h = await open(tester, emailSession, appleCode: 'unused');
      await scrollToText(tester, 'Delete account and all data');
      await tester.tap(find.widgetWithText(FilledButton, 'Delete account and all data'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Apple'), findsNothing);
      await confirmDangerous(tester, 'Delete everything');
      expect(h.authRepo.calls, isNot(contains('appleCode')));
      expect(h.api.deleteCodes, [null]);
    });
  });
}
