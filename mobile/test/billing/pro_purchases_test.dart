import 'dart:async';

import 'package:daily_grind/api/api_client.dart';
import 'package:daily_grind/api/subscription.dart';
import 'package:daily_grind/billing/pro_purchases.dart';
import 'package:daily_grind/billing/store_billing.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_store.dart';

const pro = SubscriptionInfo(plan: 'pro', status: 'active', source: 'apple');
const free = SubscriptionInfo(plan: 'free', status: 'expired', source: 'apple');

class Rig {
  Rig({this.store, Future<SubscriptionInfo> Function(StorePlatform, String)? verify, String? Function()? user}) {
    store ??= FakeStore();
    verifyCalls = [];
    purchases = ProPurchases(
      billing: store!,
      productId: 'pro_monthly',
      verify: (platform, token) async {
        verifyCalls.add('${platform.wire}:$token');
        return (verify ?? (_, _) async => pro)(platform, token);
      },
      currentUserId: user ?? () => 'user-1',
      onSubscriptionChanged: () => changed++,
    );
  }

  FakeStore? store;
  late final ProPurchases purchases;
  late final List<String> verifyCalls;
  int changed = 0;

  FakeStore get fake => store!;

  Future<void> settle() => Future<void>.delayed(Duration.zero);
}

void main() {
  group('loading the product', () {
    test('a listed product is ready to buy, with its store price', () async {
      final r = Rig();
      await r.purchases.start();
      expect(r.purchases.stage, PurchaseStage.ready);
      expect(r.purchases.product!.price, r'$4.99');
    });

    test('no store on the device, or no such product in it, means unavailable', () async {
      final noStore = Rig(store: FakeStore(available: false));
      await noStore.purchases.start();
      expect(noStore.purchases.stage, PurchaseStage.unavailable);

      final noProduct = Rig(store: FakeStore()..product = null);
      await noProduct.purchases.start();
      expect(noProduct.purchases.stage, PurchaseStage.unavailable);
    });

    test('starting twice listens once', () async {
      final r = Rig();
      await r.purchases.start();
      await r.purchases.start();
      r.fake.deliver(StoreEventKind.purchased);
      await r.settle();
      expect(r.verifyCalls, hasLength(1));
    });
  });

  group('buying', () {
    test('opens the sheet with the signed-in account attached', () async {
      final r = Rig();
      await r.purchases.start();
      await r.purchases.buy();
      expect(r.fake.bought.single, (productId: 'pro_monthly', accountId: 'user-1'));
      expect(r.purchases.stage, PurchaseStage.purchasing);
      expect(r.purchases.busy, isTrue);
    });

    test('does nothing when signed out or not ready', () async {
      final r = Rig(user: () => null);
      await r.purchases.start();
      await r.purchases.buy();
      expect(r.fake.bought, isEmpty);

      final unavailable = Rig(store: FakeStore(available: false));
      await unavailable.purchases.start();
      await unavailable.purchases.buy();
      expect(unavailable.fake.bought, isEmpty);
    });

    test('a sheet that will not open says so and lets the person try again', () async {
      final r = Rig(store: FakeStore()..sheetOpens = false);
      await r.purchases.start();
      await r.purchases.buy();
      expect(r.purchases.stage, PurchaseStage.ready);
      expect(r.purchases.message, 'Could not open the store. Please try again.');
      expect(r.purchases.messageIsError, isTrue);
    });

    test('backing out of the sheet returns quietly to ready', () async {
      final r = Rig();
      await r.purchases.start();
      await r.purchases.buy();
      r.fake.deliver(StoreEventKind.canceled, token: null);
      await r.settle();
      expect(r.purchases.stage, PurchaseStage.ready);
      expect(r.purchases.message, isNull);
      expect(r.verifyCalls, isEmpty);
    });

    test('a store failure is shown, and the failed transaction is finished', () async {
      final r = Rig();
      await r.purchases.start();
      await r.purchases.buy();
      r.fake.deliver(StoreEventKind.failed, token: null, message: 'Payment declined');
      await r.settle();
      expect(r.purchases.message, 'Payment declined');
      expect(r.purchases.messageIsError, isTrue);
      expect(r.fake.completed, ['failed:null']);
    });

    test('waiting for approval is shown as busy', () async {
      final r = Rig();
      await r.purchases.start();
      await r.purchases.buy();
      r.fake.deliver(StoreEventKind.pending, token: null);
      await r.settle();
      expect(r.purchases.stage, PurchaseStage.purchasing);
      expect(r.purchases.message, contains('Waiting'));
    });
  });

  group('confirming with the server', () {
    test('a purchase is finished with the store only after the server accepts it, and the plan is re-read', () async {
      final gate = Completer<SubscriptionInfo>();
      final r = Rig(verify: (_, _) => gate.future);
      await r.purchases.start();
      await r.purchases.buy();
      r.fake.deliver(StoreEventKind.purchased, token: 'txn-9');
      await r.settle();

      expect(r.purchases.stage, PurchaseStage.verifying);
      expect(r.verifyCalls, ['apple:txn-9']);
      expect(r.fake.completed, isEmpty, reason: 'not delivered until the server has agreed');

      gate.complete(pro);
      await r.settle();
      expect(r.fake.completed, ['purchased:txn-9']);
      expect(r.changed, 1);
      expect(r.purchases.stage, PurchaseStage.ready);
      expect(r.purchases.message, 'Welcome to Pro!');
    });

    test('the Google purchase token goes to the server under its own platform name', () async {
      final r = Rig(store: FakeStore(platform: StorePlatform.google));
      await r.purchases.start();
      r.fake.deliver(StoreEventKind.purchased, token: 'google-token');
      await r.settle();
      expect(r.verifyCalls, ['google:google-token']);
    });

    test('a restored purchase says it was restored', () async {
      final r = Rig();
      await r.purchases.start();
      await r.purchases.restore();
      expect(r.fake.restores, 1);
      r.fake.deliver(StoreEventKind.restored);
      await r.settle();
      expect(r.purchases.message, 'Your Pro subscription is restored.');
    });

    test('an ended subscription is accepted as a fact but does not claim Pro', () async {
      final r = Rig(verify: (_, _) async => free);
      await r.purchases.start();
      r.fake.deliver(StoreEventKind.restored);
      await r.settle();
      expect(r.purchases.message, 'That subscription has ended, so Pro is not active.');
    });

    test('a network or server problem leaves the purchase unfinished, to be confirmed on the next launch', () async {
      for (final error in [const ApiException.network('offline'), const ApiException(500, 'boom'), const ApiException(503, 'later')]) {
        final r = Rig(verify: (_, _) async => throw error);
        await r.purchases.start();
        r.fake.deliver(StoreEventKind.purchased);
        await r.settle();
        expect(r.fake.completed, isEmpty, reason: '$error');
        expect(r.changed, 0);
        expect(r.purchases.message, contains('confirmed the next time you open the app'));
        expect(r.purchases.messageIsError, isTrue);
      }
    });

    test('a refusal shows the server\'s reason and leaves the purchase unfinished', () async {
      final r = Rig(verify: (_, _) async => throw const ApiException(409, 'You already have an active subscription on the web.'));
      await r.purchases.start();
      r.fake.deliver(StoreEventKind.purchased);
      await r.settle();
      expect(r.purchases.message, 'You already have an active subscription on the web.');
      expect(r.fake.completed, isEmpty);
      expect(r.changed, 0);
    });

    test('a purchase without a receipt is not sent to the server', () async {
      final r = Rig();
      await r.purchases.start();
      r.fake.deliver(StoreEventKind.purchased, token: null);
      await r.settle();
      expect(r.verifyCalls, isEmpty);
      expect(r.purchases.message, contains('Restore purchases'));
    });

    test('an unfinished purchase delivered at launch is confirmed without the person doing anything', () async {
      final r = Rig();
      final p = r.purchases.start();
      r.fake.deliver(StoreEventKind.restored, token: 'left-over');
      await p;
      await r.settle();
      expect(r.verifyCalls, ['apple:left-over']);
      expect(r.fake.completed, ['restored:left-over']);
    });
  });

  group('restore', () {
    test('with nothing to restore, stops waiting after a while and says so', () {
      fakeAsync((async) {
        final r = Rig();
        unawaited(r.purchases.start());
        async.flushMicrotasks();
        unawaited(r.purchases.restore());
        async.flushMicrotasks();
        expect(r.purchases.stage, PurchaseStage.purchasing);
        async.elapse(const Duration(seconds: 9));
        expect(r.purchases.stage, PurchaseStage.ready);
        expect(r.purchases.message, 'No earlier purchases were found.');
      });
    });

    test('is not offered while another purchase is in progress', () async {
      final r = Rig();
      await r.purchases.start();
      await r.purchases.buy();
      await r.purchases.restore();
      expect(r.fake.restores, 0);
    });
  });
}
