import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:daily_grind/api/api_client.dart';
import 'package:daily_grind/api/plan_generation.dart';
import 'package:daily_grind/api/subscription.dart';
import 'package:daily_grind/auth/auth_models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class FakeTokens implements AuthTokenProvider {
  FakeTokens({this.token = 'tok-1', this.refreshed = 'tok-2'});

  String? token;
  String? refreshed;
  int refreshCalls = 0;

  @override
  Future<String?> getAccessToken() async => token;

  @override
  Future<String?> refreshAccessToken() async {
    refreshCalls++;
    return refreshed;
  }
}

http.Response json(Object body, [int status = 200, Map<String, String> headers = const {}]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json', ...headers});

ApiClient clientFor(MockClient mock, FakeTokens tokens, {Duration? timeout}) => ApiClient(
      baseUrl: 'https://api.example.com/',
      tokens: tokens,
      client: mock,
      timeout: timeout ?? const Duration(seconds: 5),
    );

PlanParams params({List<BodyFocus> focus = const []}) => PlanParams(
      goal: Goal.weightLoss,
      experience: Experience.beginner,
      daysPerWeek: 3,
      equipment: Equipment.homeGym,
      duration: SessionDuration.min45,
      bodyFocus: focus,
    );

void main() {
  group('requests', () {
    test('GET /api/subscription sends the bearer token and parses the plan', () async {
      late http.Request seen;
      final api = clientFor(
        MockClient((r) async {
          seen = r;
          return json({'plan': 'pro', 'status': 'active', 'stripeCustomerId': 'cus_1', 'currentPeriodEnd': '2026-11-01T00:00:00Z'});
        }),
        FakeTokens(),
      );
      final sub = await api.getSubscription();
      expect(seen.method, 'GET');
      expect(seen.url.toString(), 'https://api.example.com/api/subscription');
      expect(seen.headers['Authorization'], 'Bearer tok-1');
      expect(sub.hasProAccess, isTrue);
      expect(sub.stripeCustomerId, 'cus_1');
    });

    test('a base URL with a path prefix is respected', () async {
      late Uri seen;
      final api = ApiClient(
        baseUrl: 'https://example.com/gym',
        tokens: FakeTokens(),
        client: MockClient((r) async {
          seen = r.url;
          return json({'plan': 'free', 'status': 'inactive'});
        }),
      );
      await api.getSubscription();
      expect(seen.toString(), 'https://example.com/gym/api/subscription');
    });

    test('GET /api/ai-config needs no token', () async {
      late http.Request seen;
      final api = clientFor(
        MockClient((r) async {
          seen = r;
          return json({'enabledProviders': ['google', 'anthropic', 7]});
        }),
        FakeTokens(token: null),
      );
      expect(await api.getEnabledProviders(), ['google', 'anthropic']);
      expect(seen.headers.containsKey('Authorization'), isFalse);
    });

    test('user settings: get and put the AI provider', () async {
      final seen = <http.Request>[];
      final api = clientFor(
        MockClient((r) async {
          seen.add(r);
          return json({'aiProvider': r.method == 'PUT' ? 'anthropic' : 'google'});
        }),
        FakeTokens(),
      );
      expect(await api.getAiProvider(), 'google');
      expect(await api.setAiProvider('anthropic'), 'anthropic');
      expect(seen.last.method, 'PUT');
      expect(jsonDecode(seen.last.body), {'aiProvider': 'anthropic'});
      expect(seen.last.headers['Content-Type'], startsWith('application/json'));
    });

    test('DELETE /api/delete-account', () async {
      late http.Request seen;
      final api = clientFor(MockClient((r) async {
        seen = r;
        return json({'success': true});
      }), FakeTokens());
      await api.deleteAccount();
      expect([seen.method, seen.url.path], ['DELETE', '/api/delete-account']);
    });

    test('a 204 is success with no body', () async {
      final api = clientFor(MockClient((_) async => http.Response('', 204)), FakeTokens());
      await api.deleteAccount();
    });
  });

  group('verifyStorePurchase', () {
    test('POSTs the platform and token, and parses the resulting subscription including who bills it', () async {
      late http.Request seen;
      final api = clientFor(
        MockClient((r) async {
          seen = r;
          return json({'plan': 'pro', 'status': 'active', 'stripeCustomerId': null, 'currentPeriodEnd': '2026-11-03T12:00:00.000Z', 'source': 'apple'});
        }),
        FakeTokens(),
      );
      final sub = await api.verifyStorePurchase('apple', 'txn-1');
      expect(seen.method, 'POST');
      expect(seen.url.toString(), 'https://api.example.com/api/store-purchase');
      expect(seen.headers['Authorization'], 'Bearer tok-1');
      expect(jsonDecode(seen.body), {'platform': 'apple', 'token': 'txn-1'});
      expect(sub.hasProAccess, isTrue);
      expect(sub.source, 'apple');
      expect(sub.isStoreBilled, isTrue);
    });

    test('a refusal carries the server\'s reason', () async {
      final api = clientFor(MockClient((_) async => json({'error': 'This purchase belongs to a different account.'}, 403)), FakeTokens());
      await expectLater(
        api.verifyStorePurchase('google', 'tok'),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 403).having((e) => e.message, 'message', 'This purchase belongs to a different account.')),
      );
    });

    test('503 means the server has not been set up for store billing', () async {
      final api = clientFor(MockClient((_) async => json({'error': 'Subscriptions in the app are not available yet.'}, 503)), FakeTokens());
      await expectLater(api.verifyStorePurchase('apple', 't'), throwsA(isA<ApiException>().having((e) => e.isServerError, 'server error', isTrue)));
    });
  });

  group('deleteAccount', () {
    test('sends the fresh Apple code in the body when there is one, and no body otherwise', () async {
      final seen = <http.Request>[];
      final api = clientFor(MockClient((r) async {
        seen.add(r);
        return json({'ok': true});
      }), FakeTokens());
      await api.deleteAccount(appleAuthorizationCode: 'fresh');
      await api.deleteAccount();
      expect(seen.map((r) => r.method), ['DELETE', 'DELETE']);
      expect(seen.every((r) => r.url.toString() == 'https://api.example.com/api/delete-account'), isTrue);
      expect(jsonDecode(seen[0].body), {'appleAuthorizationCode': 'fresh'});
      expect(seen[1].body, isEmpty);
    });
  });

  group('linkAppleAuthorization', () {
    test('POSTs the one-time code with the bearer token', () async {
      late http.Request seen;
      final api = clientFor(MockClient((r) async {
        seen = r;
        return json({'ok': true});
      }), FakeTokens());
      await api.linkAppleAuthorization('the-code');
      expect(seen.method, 'POST');
      expect(seen.url.toString(), 'https://api.example.com/api/apple-token');
      expect(seen.headers['Authorization'], 'Bearer tok-1');
      expect(jsonDecode(seen.body), {'authorizationCode': 'the-code'});
    });

    test('a server that is not set up for it answers 503, which the caller may ignore', () async {
      final api = clientFor(MockClient((_) async => json({'error': 'Sign in with Apple is not set up on the server yet.'}, 503)), FakeTokens());
      await expectLater(api.linkAppleAuthorization('c'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 503)));
    });
  });

  group('subscription source', () {
    test('is read when present and absent for older servers', () {
      expect(SubscriptionInfo.fromJson({'plan': 'pro', 'status': 'active', 'source': 'google'}).isStoreBilled, isTrue);
      expect(SubscriptionInfo.fromJson({'plan': 'pro', 'status': 'active', 'source': 'stripe'}).isStoreBilled, isFalse);
      expect(SubscriptionInfo.fromJson({'plan': 'pro', 'status': 'active'}).source, isNull);
    });
  });

  group('generatePlan', () {
    test('sends the plan parameters, leaving bodyFocus out when empty', () async {
      late Object? body;
      final api = clientFor(MockClient((r) async {
        body = jsonDecode(r.body);
        return json({'templates': {}});
      }), FakeTokens());
      await api.generatePlan(params());
      expect(body, {'goal': 'weight_loss', 'experience': 'beginner', 'daysPerWeek': 3, 'equipment': 'home_gym', 'duration': '45'});

      await api.generatePlan(params(focus: [BodyFocus.legs, BodyFocus.core]));
      expect((body as Map)['bodyFocus'], ['legs', 'core']);
    });

    test('tags templates as AI-made, sanitises them and returns the plan meta', () async {
      final api = clientFor(MockClient((_) async => json({
            'templates': {
              'push': {
                'label': '  Push  ',
                'warmup': [
                  {'id': 'ID-1', 'text': 'Arm circles', 'target': '2x10'},
                ],
                'main': [
                  {'id': 'ID-2', 'text': 'Bench press', 'target': '3x8', 'equipment': 'Barbell'},
                ],
              },
            },
            'split': 'Push / Pull',
            'schedule': ['push', 'pull', 7],
            'progression': 'Add weight weekly',
            'notes': 'Eat well',
          })), FakeTokens());
      final plan = await api.generatePlan(params());
      final push = plan.templates['push']!;
      expect(push.source, 'ai');
      expect(push.label, 'Push');
      expect(push.main.single.equipment, 'Barbell');
      expect(plan.schedule, ['push', 'pull']);
      expect(plan.meta, {'split': 'Push / Pull', 'schedule': ['push', 'pull'], 'progression': 'Add weight weekly', 'notes': 'Eat well'});
    });

    test('an old-style flat response has no meta', () async {
      final api = clientFor(MockClient((_) async => json({'templates': {'gym': {'warmup': [], 'main': []}}})), FakeTokens());
      final plan = await api.generatePlan(params());
      expect(plan.meta, isNull);
      expect(plan.templates.keys, ['gym']);
    });

    test('a response without templates is an error, not a crash', () async {
      final api = clientFor(MockClient((_) async => json({'oops': true})), FakeTokens());
      await expectLater(api.generatePlan(params()), throwsA(isA<ApiException>()));
    });

    test('uses the longer generate timeout', () async {
      final api = ApiClient(
        baseUrl: 'https://api.example.com',
        tokens: FakeTokens(),
        timeout: const Duration(milliseconds: 20),
        generateTimeout: const Duration(seconds: 2),
        client: MockClient((_) async {
          await Future<void>.delayed(const Duration(milliseconds: 120));
          return json({'templates': {}});
        }),
      );
      expect((await api.generatePlan(params())).templates, isEmpty);
    });
  });

  group('authentication', () {
    test('signed out: fails with 401 without sending anything', () async {
      var sent = false;
      final api = clientFor(MockClient((_) async {
        sent = true;
        return json({});
      }), FakeTokens(token: null));
      await expectLater(api.getSubscription(), throwsA(isA<ApiException>().having((e) => e.isUnauthorized, '401', isTrue)));
      expect(sent, isFalse);
    });

    test('a 401 refreshes the token and retries once with the new one', () async {
      final auths = <String?>[];
      final tokens = FakeTokens();
      final api = clientFor(MockClient((r) async {
        auths.add(r.headers['Authorization']);
        return auths.length == 1 ? json({'error': 'Unauthorized'}, 401) : json({'plan': 'free', 'status': 'inactive'});
      }), tokens);
      await api.getSubscription();
      expect(auths, ['Bearer tok-1', 'Bearer tok-2']);
      expect(tokens.refreshCalls, 1);
    });

    test('the retry keeps the request body', () async {
      final bodies = <String>[];
      final api = clientFor(MockClient((r) async {
        bodies.add(r.body);
        return bodies.length == 1 ? json({'error': 'Unauthorized'}, 401) : json({'aiProvider': 'google'});
      }), FakeTokens());
      await api.setAiProvider('google');
      expect(bodies, [jsonEncode({'aiProvider': 'google'}), jsonEncode({'aiProvider': 'google'})]);
    });

    test('a second 401 is surfaced after exactly one refresh', () async {
      var calls = 0;
      final tokens = FakeTokens();
      final api = clientFor(MockClient((_) async {
        calls++;
        return json({'error': 'Unauthorized'}, 401);
      }), tokens);
      await expectLater(api.getSubscription(), throwsA(isA<ApiException>().having((e) => e.isUnauthorized, '401', isTrue)));
      expect([calls, tokens.refreshCalls], [2, 1]);
    });

    test('a 401 with nothing to refresh is surfaced without a retry', () async {
      var calls = 0;
      final api = clientFor(MockClient((_) async {
        calls++;
        return json({'error': 'Unauthorized'}, 401);
      }), FakeTokens(refreshed: null));
      await expectLater(api.getSubscription(), throwsA(isA<ApiException>()));
      expect(calls, 1);
    });

    test('an unauthenticated route does not try to refresh on 401', () async {
      final tokens = FakeTokens();
      final api = clientFor(MockClient((_) async => json({'error': 'no'}, 401)), tokens);
      await expectLater(api.getEnabledProviders(), throwsA(isA<ApiException>()));
      expect(tokens.refreshCalls, 0);
    });
  });

  group('errors', () {
    test('parses error, retryAfter, plan and requestId from the body', () async {
      final api = clientFor(MockClient((_) async => json({
            'error': 'Free allows 1 a day.',
            'retryAfter': 7200,
            'plan': 'free',
          }, 429)), FakeTokens());
      final e = await api.generatePlan(params()).then<ApiException>((_) => throw 'no error', onError: (e) => e as ApiException);
      expect([e.status, e.message, e.retryAfterSeconds, e.plan], [429, 'Free allows 1 a day.', 7200, 'free']);
      expect(e.isRateLimited, isTrue);
    });

    test('falls back to the x-request-id header and a generic message', () async {
      final api = clientFor(MockClient((_) async => http.Response('<html>bad gateway</html>', 502, headers: {'x-request-id': 'req-9'})), FakeTokens());
      final e = await api.getSubscription().then<ApiException>((_) => throw 'no error', onError: (e) => e as ApiException);
      expect([e.status, e.message, e.requestId, e.isServerError], [502, 'Request failed (502).', 'req-9', true]);
    });

    test('a 200 that is not JSON is an error', () async {
      final api = clientFor(MockClient((_) async => http.Response('hello', 200)), FakeTokens());
      await expectLater(api.getSubscription(), throwsA(isA<ApiException>()));
    });

    test('offline becomes a network error', () async {
      final api = clientFor(MockClient((_) async => throw const SocketException('down')), FakeTokens());
      await expectLater(api.getSubscription(), throwsA(isA<ApiException>().having((e) => e.isNetwork, 'network', isTrue)));
    });

    test('a client-side failure becomes a network error', () async {
      final api = clientFor(MockClient((_) async => throw http.ClientException('reset')), FakeTokens());
      await expectLater(api.getSubscription(), throwsA(isA<ApiException>().having((e) => e.isNetwork, 'network', isTrue)));
    });

    test('a slow server times out as a network error', () async {
      final api = clientFor(
        MockClient((_) => Completer<http.Response>().future),
        FakeTokens(),
        timeout: const Duration(milliseconds: 30),
      );
      await expectLater(api.getSubscription(), throwsA(isA<ApiException>().having((e) => e.isNetwork, 'network', isTrue)));
    });
  });
}
