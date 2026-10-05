import 'dart:async';

import 'package:daily_grind/billing/store_billing.dart';

/// A store the test controls: what it lists, whether the sheet opens, and what happens to purchases.
class FakeStore implements StoreBilling {
  FakeStore({this.platform = StorePlatform.apple, this.available = true, this.product = const StoreProduct(id: 'pro_monthly', title: 'Daily Grind Pro', price: r'$4.99')});

  @override
  final StorePlatform platform;

  bool available;
  StoreProduct? product;
  bool sheetOpens = true;

  final _events = StreamController<StorePurchaseEvent>.broadcast();
  final bought = <({String productId, String accountId})>[];
  int restores = 0;
  final completed = <String>[];

  @override
  Stream<StorePurchaseEvent> get events => _events.stream;

  /// A purchase event as the store would deliver it; completing it is recorded in [completed].
  void deliver(StoreEventKind kind, {String? token = 'txn-1', String? message}) => _events.add(StorePurchaseEvent(
        kind,
        productId: 'pro_monthly',
        token: token,
        message: message,
        complete: () async => completed.add('${kind.name}:$token'),
      ));

  @override
  Future<bool> isAvailable() async => available;

  @override
  Future<StoreProduct?> loadProduct(String productId) async => product;

  @override
  Future<bool> buy(String productId, {required String accountId}) async {
    bought.add((productId: productId, accountId: accountId));
    return sheetOpens;
  }

  @override
  Future<void> restore({required String accountId}) async => restores++;

  Future<void> close() => _events.close();
}
