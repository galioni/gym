/// The phone's store (App Store / Google Play) as the rest of the app sees it: one product to sell, a stream of what happened
/// to purchases, and a way to finish each one. The real implementation wraps the `in_app_purchase` plugin; tests use a fake.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:in_app_purchase/in_app_purchase.dart';

/// Which store a purchase went through; the wire value for `POST /api/store-purchase`.
enum StorePlatform {
  apple('apple'),
  google('google');

  const StorePlatform(this.wire);
  final String wire;
}

class StoreProduct {
  const StoreProduct({required this.id, required this.title, required this.price});

  final String id;
  final String title;

  /// The price as the store formats it for the person's country ("$4.99", "4,99 €").
  final String price;
}

enum StoreEventKind {
  /// A new purchase went through.
  purchased,

  /// An earlier purchase was handed back by "Restore purchases" or on app start (an unfinished purchase).
  restored,

  /// Waiting on the store (a parent's approval, a slow payment method).
  pending,

  /// The person backed out.
  canceled,

  /// The store reported a failure.
  failed,
}

class StorePurchaseEvent {
  const StorePurchaseEvent(this.kind, {this.productId, this.token, this.message, this.complete});

  final StoreEventKind kind;
  final String? productId;

  /// What the server needs to look the purchase up: the Apple transaction id, or the Google purchase token.
  final String? token;
  final String? message;

  /// Tells the store the purchase has been delivered (Apple: finishes the transaction; Google: acknowledges it, which must
  /// happen within three days or Google refunds the purchase). Null when there is nothing to finish.
  final Future<void> Function()? complete;
}

abstract class StoreBilling {
  StorePlatform get platform;

  /// What happens to purchases, including ones left unfinished by an earlier run (delivered when this is first listened to).
  Stream<StorePurchaseEvent> get events;

  /// False on devices without a store (and in the emulator without Play services).
  Future<bool> isAvailable();

  /// Null when the store does not list this product (not created yet, not approved yet).
  Future<StoreProduct?> loadProduct(String productId);

  /// Starts the store's purchase sheet. [accountId] (the signed-in user's id) is attached to the purchase so the server can
  /// tell whose it is. The outcome arrives on [events]. False if the sheet could not be opened.
  Future<bool> buy(String productId, {required String accountId});

  /// Asks the store to hand back this person's earlier purchases, through [events].
  Future<void> restore({required String accountId});
}

class InAppPurchaseBilling implements StoreBilling {
  InAppPurchaseBilling({InAppPurchase? iap, StorePlatform? platform})
      : _iap = iap ?? InAppPurchase.instance,
        platform = platform ?? (defaultTargetPlatform == TargetPlatform.iOS ? StorePlatform.apple : StorePlatform.google);

  final InAppPurchase _iap;
  final _products = <String, ProductDetails>{};

  @override
  final StorePlatform platform;

  @override
  Stream<StorePurchaseEvent> get events => _iap.purchaseStream.expand((list) => list.map(_event));

  StorePurchaseEvent _event(PurchaseDetails p) {
    Future<void> Function()? complete;
    if (p.pendingCompletePurchase) complete = () => _iap.completePurchase(p);

    switch (p.status) {
      case PurchaseStatus.pending:
        return StorePurchaseEvent(StoreEventKind.pending, productId: p.productID);
      case PurchaseStatus.canceled:
        return StorePurchaseEvent(StoreEventKind.canceled, productId: p.productID, complete: complete);
      case PurchaseStatus.error:
        return StorePurchaseEvent(StoreEventKind.failed, productId: p.productID, message: p.error?.message, complete: complete);
      case PurchaseStatus.purchased:
      case PurchaseStatus.restored:
        final token = platform == StorePlatform.apple ? p.purchaseID : p.verificationData.serverVerificationData;
        return StorePurchaseEvent(
          p.status == PurchaseStatus.restored ? StoreEventKind.restored : StoreEventKind.purchased,
          productId: p.productID,
          token: token == null || token.isEmpty ? null : token,
          complete: complete,
        );
    }
  }

  @override
  Future<bool> isAvailable() => _iap.isAvailable();

  @override
  Future<StoreProduct?> loadProduct(String productId) async {
    final response = await _iap.queryProductDetails({productId});
    if (response.error != null || response.productDetails.isEmpty) return null;
    final details = response.productDetails.first;
    _products[productId] = details;
    return StoreProduct(id: details.id, title: details.title, price: details.price);
  }

  @override
  Future<bool> buy(String productId, {required String accountId}) {
    final details = _products[productId];
    if (details == null) return Future.value(false);
    // `applicationUserName` becomes Apple's appAccountToken (a UUID: our user ids are) and Google's obfuscatedAccountId.
    return _iap.buyNonConsumable(purchaseParam: PurchaseParam(productDetails: details, applicationUserName: accountId));
  }

  @override
  Future<void> restore({required String accountId}) => _iap.restorePurchases(applicationUserName: accountId);
}
