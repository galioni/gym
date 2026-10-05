/// The account's plan, as `GET /api/subscription` reports it, plus the small cache the web app keeps.
library;

import '../domain/models.dart';

class SubscriptionInfo {
  const SubscriptionInfo({
    required this.plan,
    required this.status,
    this.stripeCustomerId,
    this.currentPeriodEnd,
    this.source,
  });

  static const free = SubscriptionInfo(plan: 'free', status: 'inactive');

  /// `free` or `pro`.
  final String plan;
  final String status;
  final String? stripeCustomerId;

  /// ISO timestamp of the end of the paid period, when there is one.
  final String? currentPeriodEnd;

  /// Who bills it: `stripe` (managed on the web), `apple` or `google` (managed in that store); null if never subscribed.
  final String? source;

  factory SubscriptionInfo.fromJson(Json j) => SubscriptionInfo(
        plan: j['plan'] == 'pro' ? 'pro' : 'free',
        status: j['status'] is String ? j['status'] as String : 'inactive',
        stripeCustomerId: j['stripeCustomerId'] is String ? j['stripeCustomerId'] as String : null,
        currentPeriodEnd: j['currentPeriodEnd'] is String ? j['currentPeriodEnd'] as String : null,
        source: j['source'] is String ? j['source'] as String : null,
      );

  bool get isStoreBilled => source == 'apple' || source == 'google';

  /// Full Pro access, by the server's rule: an active or trialing Pro subscription.
  bool get hasProAccess => plan == 'pro' && (status == 'active' || status == 'trialing');
}

class SubscriptionResult {
  const SubscriptionResult(this.info, {this.fetchError = false});

  final SubscriptionInfo info;

  /// True when the lookup failed and [info] is the Free default, so the UI can say the status is unconfirmed
  /// instead of presenting a paying user as Free.
  final bool fetchError;
}

/// Fetches the subscription and keeps it for [ttl] per user, so screens can ask freely. A failed lookup is not
/// cached and falls back to Free (the server does the same: an outage never locks anyone out).
class SubscriptionService {
  SubscriptionService(
    this._fetch, {
    this.ttl = const Duration(minutes: 5),
    this._now = DateTime.now,
  });

  final Future<SubscriptionInfo> Function() _fetch;
  final Duration ttl;
  final DateTime Function() _now;
  final _cache = <String, ({SubscriptionInfo info, DateTime expiresAt})>{};

  Future<SubscriptionResult> get(String userId, {bool force = false}) async {
    final hit = _cache[userId];
    if (!force && hit != null && _now().isBefore(hit.expiresAt)) return SubscriptionResult(hit.info);
    try {
      final info = await _fetch();
      _cache[userId] = (info: info, expiresAt: _now().add(ttl));
      return SubscriptionResult(info);
    } catch (_) {
      return const SubscriptionResult(SubscriptionInfo.free, fetchError: true);
    }
  }

  /// Drops what is cached, e.g. after sign-out or a purchase.
  void invalidate([String? userId]) => userId == null ? _cache.clear() : _cache.remove(userId);
}
