import 'package:daily_grind/auth/auth_controller.dart';
import 'package:daily_grind/data/local_database.dart';
import 'package:daily_grind/data/sync_owner.dart';
import 'package:daily_grind/main.dart';
import 'package:daily_grind/state/theme_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../auth/fake_auth_repository.dart';

void main() {
  group('ThemeController', () {
    test('starts light, like the web app', () {
      final c = ThemeController(LocalDatabase.inMemory());
      expect(c.preference, ThemePreference.light);
      expect(c.mode, ThemeMode.light);
    });

    test('remembers the choice on this device', () {
      final db = LocalDatabase.inMemory();
      ThemeController(db).select(ThemePreference.dark);
      expect(ThemeController(db).preference, ThemePreference.dark);
      ThemeController(db).select(ThemePreference.system);
      expect(ThemeController(db).mode, ThemeMode.system);
    });

    test('ignores a stored value it does not know', () {
      final db = LocalDatabase.inMemory()..writeDoc(ThemeController.storageKey, 'sepia');
      expect(ThemeController(db).preference, ThemePreference.light);
      db.writeDoc(ThemeController.storageKey, 42);
      expect(ThemeController(db).preference, ThemePreference.light);
    });

    test('notifies only when the choice changes', () {
      final c = ThemeController.inMemory();
      var calls = 0;
      c.addListener(() => calls++);
      c.select(ThemePreference.light);
      expect(calls, 0);
      c.select(ThemePreference.dark);
      expect(calls, 1);
    });

    test('survives clearing an account off the device (sign-out as another user, account deletion), unlike account data', () {
      final db = LocalDatabase.inMemory();
      ThemeController(db).select(ThemePreference.dark);
      db.writeDoc('onboarded', true);

      SqliteSyncOwner(db).switchOwner('someone-else');
      expect(ThemeController(db).preference, ThemePreference.dark);
      expect(db.readDoc('onboarded'), isNull, reason: 'account data is still removed');

      db.writeDoc('onboarded', true);
      SqliteSyncOwner(db).clearAll();
      expect(ThemeController(db).preference, ThemePreference.dark);
      expect(db.readDoc('onboarded'), isNull);
    });
  });

  group('the app follows the choice', () {
    testWidgets('switching changes the whole app at once, even on the sign-in screen', (tester) async {
      final auth = AuthController(FakeAuthRepository());
      addTearDown(auth.dispose);
      final theme = ThemeController.inMemory();
      await tester.pumpWidget(DailyGrindApp(auth: auth, theme: theme, createServices: (_) => throw StateError('not signed in')));
      await auth.start();
      await tester.pumpAndSettle();

      ThemeMode mode() => tester.widget<MaterialApp>(find.byType(MaterialApp)).themeMode!;
      expect(mode(), ThemeMode.light);
      theme.select(ThemePreference.dark);
      await tester.pump();
      expect(mode(), ThemeMode.dark);
      theme.select(ThemePreference.system);
      await tester.pump();
      expect(mode(), ThemeMode.system);
    });

    testWidgets('without a controller it is light', (tester) async {
      final auth = AuthController(FakeAuthRepository());
      addTearDown(auth.dispose);
      await tester.pumpWidget(DailyGrindApp(auth: auth, createServices: (_) => throw StateError('not signed in')));
      await auth.start();
      await tester.pumpAndSettle();
      expect(tester.widget<MaterialApp>(find.byType(MaterialApp)).themeMode, ThemeMode.light);
    });
  });
}
