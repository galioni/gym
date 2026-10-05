import 'dart:convert';
import 'dart:io';

import 'package:daily_grind/api/api_client.dart';
import 'package:daily_grind/api/plan_generation.dart';
import 'package:daily_grind/api/subscription.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('formatRetryWait matches the web app', () {
    final fixture = jsonDecode(File('../contract/api.fixtures.json').readAsStringSync()) as Map<String, dynamic>;
    test('every golden case', () {
      for (final c in fixture['retryWait'] as List) {
        expect(formatRetryWait(c['seconds'] as int), c['text'], reason: '${c['seconds']}s');
      }
    });
  });

  group('describeGeneratePlanError', () {
    test('free-plan rate limit explains itself, offers Pro and says when to retry', () {
      final f = describeGeneratePlanError(const ApiException(429, 'Free includes 1 plan a day.', retryAfterSeconds: 7200, plan: 'free'));
      expect(f.message, 'Free includes 1 plan a day. Try again in 2 hours.');
      expect(f.offersUpgrade, isTrue);
    });

    test('pro rate limit does not offer an upgrade', () {
      final f = describeGeneratePlanError(const ApiException(429, 'Pro allows 10 an hour.', retryAfterSeconds: 600, plan: 'pro'));
      expect(f.message, 'Pro allows 10 an hour. Try again in 10 minutes.');
      expect(f.offersUpgrade, isFalse);
    });

    test('a rate limit with no plan or wait uses the generic wording', () {
      final f = describeGeneratePlanError(const ApiException(429, 'whatever'));
      expect(f.message, "You've hit the plan generation limit. Try again later.");
      expect(f.offersUpgrade, isFalse);
    });

    test('server errors, other errors and offline', () {
      expect(describeGeneratePlanError(const ApiException(502, 'AI exploded')).message,
          'Plan generation failed due to a server error. Please try again in a moment.');
      expect(describeGeneratePlanError(const ApiException(400, 'Invalid request body.')).message, 'Invalid request body.');
      expect(describeGeneratePlanError(const ApiException.network('Could not reach the server.')).message, 'Could not reach the server.');
    });
  });

  group('PlanParams', () {
    PlanParams make({int days = 3, List<BodyFocus> focus = const [BodyFocus.legs]}) => PlanParams(
          goal: Goal.muscle,
          experience: Experience.advanced,
          daysPerWeek: days,
          equipment: Equipment.fullGym,
          duration: SessionDuration.min90,
          bodyFocus: focus,
        );

    test('days per week outside 2-6 is rejected, like the server', () {
      expect(() => make(days: 1), throwsArgumentError);
      expect(() => make(days: 7), throwsArgumentError);
      make(days: 2);
      make(days: 6);
    });

    test('storage JSON always has bodyFocus; round-trips', () {
      final json = make().toJson();
      expect(json, {
        'goal': 'muscle', 'experience': 'advanced', 'daysPerWeek': 3, 'equipment': 'full_gym', 'duration': '90', 'bodyFocus': ['legs'],
      });
      expect(PlanParams.tryFromJson(json)!.toJson(), json);
      expect(make(focus: const []).toJson()['bodyFocus'], isEmpty);
    });

    test('tryFromJson rejects unknown or missing values and drops unknown body focus', () {
      final ok = make().toJson();
      expect(PlanParams.tryFromJson(null), isNull);
      expect(PlanParams.tryFromJson({...ok, 'goal': 'bulk'}), isNull);
      expect(PlanParams.tryFromJson({...ok, 'duration': 45}), isNull);
      expect(PlanParams.tryFromJson({...ok, 'daysPerWeek': 9}), isNull);
      expect(PlanParams.tryFromJson({...ok, 'bodyFocus': ['legs', 'toes']})!.bodyFocus, [BodyFocus.legs]);
      expect(PlanParams.tryFromJson({...ok}..remove('bodyFocus'))!.bodyFocus, isEmpty);
    });
  });

  group('SubscriptionService', () {
    late DateTime now;
    late int calls;
    SubscriptionInfo next = const SubscriptionInfo(plan: 'pro', status: 'active');
    bool failing = false;
    late SubscriptionService service;

    setUp(() {
      now = DateTime.utc(2026, 10, 3, 12);
      calls = 0;
      failing = false;
      next = const SubscriptionInfo(plan: 'pro', status: 'active');
      service = SubscriptionService(() async {
        calls++;
        if (failing) throw const ApiException(500, 'down');
        return next;
      }, now: () => now);
    });

    test('caches per user for the ttl, then refetches', () async {
      expect((await service.get('u1')).info.hasProAccess, isTrue);
      await service.get('u1');
      expect(calls, 1);
      await service.get('u2');
      expect(calls, 2);
      now = now.add(const Duration(minutes: 5, seconds: 1));
      await service.get('u1');
      expect(calls, 3);
    });

    test('force bypasses the cache and invalidate drops it', () async {
      await service.get('u1');
      await service.get('u1', force: true);
      expect(calls, 2);
      service.invalidate('u1');
      await service.get('u1');
      expect(calls, 3);
      service.invalidate();
      await service.get('u1');
      expect(calls, 4);
    });

    test('a failed lookup falls back to Free, is flagged, and is not cached', () async {
      failing = true;
      final result = await service.get('u1');
      expect([result.info.plan, result.fetchError], ['free', true]);
      failing = false;
      final recovered = await service.get('u1');
      expect([recovered.info.hasProAccess, recovered.fetchError, calls], [true, false, 2]);
    });

    test('hasProAccess follows the server rule', () {
      bool pro(String plan, String status) => SubscriptionInfo(plan: plan, status: status).hasProAccess;
      expect(pro('pro', 'active'), isTrue);
      expect(pro('pro', 'trialing'), isTrue);
      expect(pro('pro', 'past_due'), isFalse);
      expect(pro('pro', 'canceled'), isFalse);
      expect(pro('free', 'active'), isFalse);
    });

    test('fromJson is tolerant', () {
      final s = SubscriptionInfo.fromJson({'plan': 'enterprise', 'status': 5});
      expect([s.plan, s.status, s.stripeCustomerId, s.currentPeriodEnd], ['free', 'inactive', null, null]);
    });
  });
}
