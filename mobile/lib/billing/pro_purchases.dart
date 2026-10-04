/// Buying Pro in the app: loads the product, runs the purchase, and has the server confirm it before the store is told the
/// purchase was delivered. The server decides what a purchase is worth; this class never grants anything itself.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../api/subscription.dart';
import 'store_billing.dart';

enum PurchaseStage {
  /// Not asked yet.
  idle,

  /// Looking the product up in the store.
  loading,

  /// The store has no Pro product to sell here (not set up yet, or no store on this device).
  unavailable,

  /// Product known; the person can buy.
  ready,

  /// The store's purchase sheet is open or the store is working (including waiting for approval).
  purchasing,

  /// The store says paid; the server is confirming.
  verifying,
}

/// What the subscription offer must say besides the price: how often it renews, and where the terms and privacy policy are
/// (both stores require those links next to an offer).
class PaywallText {
  const PaywallText({this.period = 'month', this.termsUrl = '', this.privacyUrl = ''});

  final String period;
  final String termsUrl;
  final String privacyUrl;
}

class ProPurchases extends ChangeNotifier {
  ProPurchases({
    required this._billing,
    required this.productId,
    required this._verify,
    required this._currentUserId,
    this.onSubscriptionChanged,
    this.paywall = const PaywallText(),
  });

  final PaywallText paywall;

  final StoreBilling _billing;
  final String productId;
  final Future<SubscriptionInfo> Function(StorePlatform platform, String token) _verify;
  final String? Function() _currentUserId;

  /// Called after the server accepted a purchase, so screens re-read the plan.
  final void Function()? onSubscriptionChanged;

  StreamSubscription<StorePurchaseEvent>? _sub;
  Timer? _restoreTimer;
  bool _disposed = false;
  bool _started = false;

  PurchaseStage _stage = PurchaseStage.idle;
  StoreProduct? _product;
  String? _message;
  bool _messageIsError = false;

  PurchaseStage get stage => _stage;
  StoreProduct? get product => _product;
  StorePlatform get platform => _billing.platform;

  /// What to tell the person about the last attempt (success or failure); cleared by the next attempt.
  String? get message => _message;
  bool get messageIsError => _messageIsError;

  bool get busy => _stage == PurchaseStage.purchasing || _stage == PurchaseStage.verifying || _stage == PurchaseStage.loading;

  void _set(PurchaseStage stage, {String? message, bool error = false}) {
    _stage = stage;
    _message = message;
    _messageIsError = error;
    if (!_disposed) notifyListeners();
  }

  /// Starts listening to the store (which first hands over any purchase left unfinished by an earlier run) and loads the
  /// product. Safe to call more than once.
  Future<void> start() async {
    if (_started) return;
    _started = true;
    _sub = _billing.events.listen(_onEvent, onError: (Object _) => _set(PurchaseStage.ready, message: 'The store reported a problem. Please try again.', error: true));
    await load();
  }

  Future<void> load() async {
    _set(PurchaseStage.loading);
    try {
      if (!await _billing.isAvailable()) {
        _set(PurchaseStage.unavailable);
        return;
      }
      final product = await _billing.loadProduct(productId);
      _product = product;
      _set(product == null ? PurchaseStage.unavailable : PurchaseStage.ready);
    } catch (_) {
      _set(PurchaseStage.unavailable);
    }
  }

  Future<void> buy() async {
    final userId = _currentUserId();
    if (_stage != PurchaseStage.ready || userId == null) return;
    _set(PurchaseStage.purchasing);
    try {
      if (!await _billing.buy(productId, accountId: userId)) {
        _set(PurchaseStage.ready, message: 'Could not open the store. Please try again.', error: true);
      }
    } catch (_) {
      _set(PurchaseStage.ready, message: 'Could not open the store. Please try again.', error: true);
    }
  }

  Future<void> restore() async {
    final userId = _currentUserId();
    if (userId == null || busy) return;
    _set(PurchaseStage.purchasing);
    try {
      await _billing.restore(accountId: userId);
      // Restored purchases arrive as events. If there are none the store says nothing, so do not stay "busy" forever.
      _restoreTimer?.cancel();
      _restoreTimer = Timer(const Duration(seconds: 8), () {
        if (!_disposed && _stage == PurchaseStage.purchasing) _set(PurchaseStage.ready, message: 'No earlier purchases were found.');
      });
    } catch (_) {
      _set(PurchaseStage.ready, message: 'Could not restore purchases. Please try again.', error: true);
    }
  }

  Future<void> _onEvent(StorePurchaseEvent event) async {
    if (_disposed) return;
    _restoreTimer?.cancel();
    switch (event.kind) {
      case StoreEventKind.pending:
        _set(PurchaseStage.purchasing, message: 'Waiting for the store to approve the purchase...');
      case StoreEventKind.canceled:
        await _finish(event);
        _set(_product == null ? PurchaseStage.unavailable : PurchaseStage.ready);
      case StoreEventKind.failed:
        await _finish(event);
        _set(_product == null ? PurchaseStage.unavailable : PurchaseStage.ready, message: event.message ?? 'The purchase did not go through.', error: true);
      case StoreEventKind.purchased:
      case StoreEventKind.restored:
        await _confirm(event);
    }
  }

  Future<void> _finish(StorePurchaseEvent event) async {
    try {
      await event.complete?.call();
    } catch (_) {
      // Finishing is best effort; the store hands the purchase over again next time.
    }
  }

  Future<void> _confirm(StorePurchaseEvent event) async {
    final token = event.token;
    if (token == null) {
      _set(PurchaseStage.ready, message: 'The store did not give us a receipt for this purchase. Try "Restore purchases".', error: true);
      return;
    }
    _set(PurchaseStage.verifying);
    try {
      final info = await _verify(_billing.platform, token);
      // The server accepted it: only now is the purchase delivered (and, on Google, acknowledged).
      await _finish(event);
      onSubscriptionChanged?.call();
      _set(
        PurchaseStage.ready,
        message: info.hasProAccess
            ? (event.kind == StoreEventKind.restored ? 'Your Pro subscription is restored.' : 'Welcome to Pro!')
            : 'That subscription has ended, so Pro is not active.',
      );
    } on ApiException catch (e) {
      // A refusal is final (another account's purchase, a double subscription): the purchase is left unfinished so the
      // store does not treat it as delivered. A network or server error is temporary: the store hands the purchase
      // over again on the next launch, and it is verified then.
      final temporary = e.isNetwork || e.isServerError;
      _set(
        PurchaseStage.ready,
        message: temporary ? "We couldn't confirm your purchase yet. It will be confirmed the next time you open the app." : e.message,
        error: true,
      );
    } catch (_) {
      _set(PurchaseStage.ready, message: "We couldn't confirm your purchase yet. It will be confirmed the next time you open the app.", error: true);
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _restoreTimer?.cancel();
    unawaited(_sub?.cancel());
    super.dispose();
  }
}
