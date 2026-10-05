import 'package:daily_grind/api/api_client.dart';
import 'package:daily_grind/api/subscription.dart';
import 'package:daily_grind/billing/pro_purchases.dart';
import 'package:daily_grind/billing/store_billing.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_store.dart';
import '../support/sync_device.dart' show mkDay;

const freePlan = SubscriptionInfo(plan: 'free', status: 'inactive');
const _paywall = PaywallText(period: 'month', termsUrl: 'https://example.com/terms', privacyUrl: 'https://example.com/privacy');

Future<void> seed(dynamic s) async {
  await s.templateRepo.writeTemplates({'tennis': const TemplateData(main: [TemplateRow(id: 't', text: 'Rally')])});
  await s.workoutRepo.saveDay(mkDay('2026-10-03', 'notes'));
}

Future<Harness> openPaywall(WidgetTester tester, FakeStore store, {Object subscription = freePlan}) async {
  final h = await pumpDashboard(tester, seed: seed, subscription: subscription, store: store, paywall: _paywall);
  await h.openSettings(tester);
  return h;
}

void main() {
  group('offer', () {
    uiTest('shows the price, renewal terms for the store, and the legal links', (tester) async {
      await openPaywall(tester, FakeStore());
      expect(find.text(r'Upgrade to Pro · $4.99 / month'), findsOneWidget);
      expect(find.text('Restore purchases'), findsOneWidget);
      expect(find.textContaining(r'renews automatically each month at $4.99'), findsOneWidget);
      expect(find.textContaining('cancel at least 24 hours before'), findsOneWidget);
      expect(find.textContaining('Apple ID'), findsWidgets);
      expect(find.text('Terms of use'), findsOneWidget);
      expect(find.text('Privacy policy'), findsOneWidget);
      expect(find.textContaining('Daily Grind web app'), findsNothing, reason: 'no pointer to buying elsewhere');
    });

    uiTest('on Android the wording names Google Play', (tester) async {
      await openPaywall(tester, FakeStore(platform: StorePlatform.google));
      expect(find.textContaining('Google Play subscription settings'), findsOneWidget);
    });

    uiTest('links open', (tester) async {
      final h = await openPaywall(tester, FakeStore());
      await tester.tap(find.text('Terms of use'));
      await tester.pump();
      expect(h.opened.single.toString(), 'https://example.com/terms');
    });

    uiTest('when the store does not list the product, says it cannot be bought now', (tester) async {
      await openPaywall(tester, FakeStore()..product = null);
      expect(find.textContaining("Pro isn't available to buy right now"), findsOneWidget);
      expect(find.textContaining('Upgrade to Pro ·'), findsNothing);
    });

    uiTest('without a store in this build, the web note remains', (tester) async {
      final h = await pumpDashboard(tester, seed: seed, subscription: freePlan);
      await h.openSettings(tester);
      expect(find.text('You can upgrade in the Daily Grind web app.'), findsOneWidget);
      expect(find.text('Restore purchases'), findsNothing);
    });
  });

  group('buying', () {
    uiTest('a purchase is confirmed with the server, then the card turns into Pro', (tester) async {
      final store = FakeStore();
      final h = await openPaywall(tester, store);
      h.api.onVerify = () => h.subscription = const SubscriptionInfo(plan: 'pro', status: 'active', source: 'apple', currentPeriodEnd: '2026-11-03T12:00:00.000Z');

      await tester.tap(find.text(r'Upgrade to Pro · $4.99 / month'));
      await tester.pump();
      expect(store.bought.single.accountId, 'u1');
      expect(find.text('Working...'), findsOneWidget);

      store.deliver(StoreEventKind.purchased, token: 'txn-42');
      await tester.pumpAndSettle();

      expect(h.api.verified, ['apple:txn-42']);
      expect(store.completed, ['purchased:txn-42']);
      expect(find.text('Pro'), findsOneWidget);
      expect(find.text('Renews 3 Nov 2026'), findsOneWidget);
      expect(find.text('Welcome to Pro!'), findsOneWidget);
      expect(find.text('Billed through the App Store.'), findsOneWidget);
      expect(find.text(r'Upgrade to Pro · $4.99 / month'), findsNothing);
    });

    uiTest('while the server confirms, the button says so and cannot be pressed twice', (tester) async {
      final store = FakeStore();
      final h = await openPaywall(tester, store);
      h.api.hold = null;
      await tester.tap(find.text(r'Upgrade to Pro · $4.99 / month'));
      await tester.pump();
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Working...')).onPressed, isNull);
      expect(tester.widget<TextButton>(find.widgetWithText(TextButton, 'Restore purchases')).onPressed, isNull);
    });

    uiTest('a refusal from the server is shown and nothing changes', (tester) async {
      final store = FakeStore();
      final h = await openPaywall(tester, store);
      h.api.failVerify = const ApiException(409, 'You already have an active subscription on the web. Manage it there before subscribing again.');
      await tester.tap(find.text(r'Upgrade to Pro · $4.99 / month'));
      await tester.pump();
      store.deliver(StoreEventKind.purchased);
      await tester.pumpAndSettle();
      expect(find.textContaining('already have an active subscription on the web'), findsOneWidget);
      expect(store.completed, isEmpty);
      expect(find.text(r'Upgrade to Pro · $4.99 / month'), findsOneWidget);
    });

    uiTest('restore hands back an earlier purchase', (tester) async {
      final store = FakeStore();
      final h = await openPaywall(tester, store);
      h.api.onVerify = () => h.subscription = const SubscriptionInfo(plan: 'pro', status: 'active', source: 'apple');
      await tester.tap(find.text('Restore purchases'));
      await tester.pump();
      expect(store.restores, 1);
      store.deliver(StoreEventKind.restored, token: 'old');
      await tester.pumpAndSettle();
      expect(h.api.verified, ['apple:old']);
      expect(find.text('Pro'), findsOneWidget);
      expect(find.text('Your Pro subscription is restored.'), findsOneWidget);
    });
  });

  group('already subscribed', () {
    uiTest('through a store: shows where it is billed and opens that store\'s subscription settings', (tester) async {
      final h = await openPaywall(tester, FakeStore(), subscription: const SubscriptionInfo(plan: 'pro', status: 'active', source: 'google', currentPeriodEnd: '2026-11-01T12:00:00.000Z'));
      expect(find.text('Billed through Google Play.'), findsOneWidget);
      expect(find.textContaining('managed in the Daily Grind web app'), findsNothing);
      await tester.tap(find.text('Manage subscription'));
      await tester.pump();
      expect(h.opened.single.toString(), 'https://play.google.com/store/account/subscriptions');
    });

    uiTest('a payment problem is called out', (tester) async {
      await openPaywall(tester, FakeStore(), subscription: const SubscriptionInfo(plan: 'pro', status: 'past_due', source: 'apple'));
      expect(find.textContaining('problem with your payment'), findsOneWidget);
    });

    uiTest('on the web plan: no store offer, and the web note stays', (tester) async {
      await openPaywall(tester, FakeStore(), subscription: const SubscriptionInfo(plan: 'pro', status: 'active', source: 'stripe'));
      expect(find.text('Subscriptions are managed in the Daily Grind web app.'), findsOneWidget);
      expect(find.text('Manage subscription'), findsNothing);
    });
  });

  group('deleting the account', () {
    uiTest('warns that a store subscription is not cancelled', (tester) async {
      await openPaywall(tester, FakeStore(), subscription: const SubscriptionInfo(plan: 'pro', status: 'active', source: 'apple'));
      await tester.scrollUntilVisible(find.text('Delete account and all data'), 300, scrollable: find.byType(Scrollable).first);
      await tester.tap(find.text('Delete account and all data'));
      await tester.pumpAndSettle();
      expect(find.textContaining('does not cancel your App Store subscription'), findsOneWidget);
    });

    uiTest('says nothing extra for a free account', (tester) async {
      await openPaywall(tester, FakeStore());
      await tester.scrollUntilVisible(find.text('Delete account and all data'), 300, scrollable: find.byType(Scrollable).first);
      await tester.tap(find.text('Delete account and all data'));
      await tester.pumpAndSettle();
      expect(find.textContaining('does not cancel'), findsNothing);
    });
  });
}
