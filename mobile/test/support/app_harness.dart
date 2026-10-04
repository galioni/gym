import 'package:daily_grind/api/api_client.dart';
import 'package:daily_grind/api/plan_generation.dart';
import 'package:daily_grind/api/subscription.dart';
import 'package:daily_grind/app/app_services.dart';
import 'package:daily_grind/billing/pro_purchases.dart';
import 'package:daily_grind/billing/store_billing.dart';
import 'package:daily_grind/app/connectivity.dart';
import 'package:daily_grind/auth/auth_controller.dart';
import 'package:daily_grind/auth/auth_models.dart';
import 'package:daily_grind/data/local_database.dart';
import 'package:daily_grind/domain/models.dart';
import 'package:daily_grind/sync/sync_allowance.dart';
import 'package:daily_grind/ui/app_scope.dart';
import 'package:daily_grind/ui/dashboard/dashboard_screen.dart';
import 'package:daily_grind/ui/signed_in_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../auth/fake_auth_repository.dart';
import 'fake_gateway.dart';

/// The real dashboard over real on-device storage (in-memory SQLite) and a fake cloud, so a test can drive the screen the way a
/// person does and look at what ended up stored.
class StubPlan {
  StubPlan({this.status = SyncAllowanceStatus.unlimited});

  SyncAllowanceStatus status;
}

class StubAllowance implements SyncAllowance {
  StubAllowance(this.plan);

  final StubPlan plan;

  @override
  Future<SyncGrant> begin() async => SyncGrant(historyDays: historyDaysFor(plan.status));

  @override
  Future<SyncAllowanceStatus> status() async => plan.status;
}

class _NoTokens implements AuthTokenProvider {
  @override
  Future<String?> getAccessToken() async => 'x';

  @override
  Future<String?> refreshAccessToken() async => 'x';
}

/// Records what the app asked the API to do, and can fail it.
class StubApi extends ApiClient {
  StubApi() : super(baseUrl: 'https://api.example.com', tokens: _NoTokens());

  int deleteCalls = 0;
  ApiException? failDelete;

  /// What plan generation returns (or fails with); `generated` records each request. `hold` makes it wait.
  GeneratedPlan? planToReturn;
  ApiException? failGenerate;
  Future<void>? hold;
  final generated = <PlanParams>[];

  /// The AI providers on offer, the account's choice, and what happens when it is changed (null = accepted).
  List<String> providers = ['google'];
  String provider = 'google';
  ApiException? failSetProvider;

  @override
  Future<GeneratedPlan> generatePlan(PlanParams params) async {
    generated.add(params);
    await hold;
    if (failGenerate != null) throw failGenerate!;
    return planToReturn ?? const GeneratedPlan(templates: {});
  }

  /// What the server answers when the app confirms a store purchase; `onVerify` lets a test change the account's plan too.
  final verified = <String>[];
  SubscriptionInfo verifyResult = const SubscriptionInfo(plan: 'pro', status: 'active', source: 'apple');
  ApiException? failVerify;
  void Function()? onVerify;

  @override
  Future<SubscriptionInfo> verifyStorePurchase(String platform, String token) async {
    verified.add('$platform:$token');
    if (failVerify != null) throw failVerify!;
    onVerify?.call();
    return verifyResult;
  }

  @override
  Future<List<String>> getEnabledProviders() async => providers;

  @override
  Future<String> getAiProvider() async => provider;

  @override
  Future<String> setAiProvider(String id) async {
    if (failSetProvider != null) throw failSetProvider!;
    return provider = id;
  }

  /// The fresh Apple code each deletion carried (null when none was sent).
  final deleteCodes = <String?>[];

  @override
  Future<void> deleteAccount({String? appleAuthorizationCode}) async {
    deleteCalls++;
    deleteCodes.add(appleAuthorizationCode);
    if (failDelete != null) throw failDelete!;
  }
}

class Harness {
  Harness._(this.services, this.auth, this.authRepo, this.cloud, this.net, this.plan, this.api, this.clock, this._subscription);

  final List<Object?> _subscription;

  /// What `GET /api/subscription` answers from now on (a SubscriptionInfo, or an exception to throw).
  set subscription(Object? value) => _subscription[0] = value;

  final AppServices services;
  final AuthController auth;
  final FakeAuthRepository authRepo;
  final FakeGateway cloud;
  final ManualConnectivity net;
  final StubPlan plan;
  final StubApi api;
  final ValueNotifier<DateTime> clock;
  final opened = <Uri>[];

  Future<Map<String, DayData>> stored() => services.workoutRepo.readAll();

  /// Opens Settings from the sync indicator in the app bar. The page is a long lazy list, so the viewport is made tall enough to
  /// build all of it (the size is restored when the test ends).
  Future<void> openSettings(WidgetTester tester) async {
    tester.view.physicalSize = const Size(420, 4200);
    await tester.tap(find.byTooltip(RegExp('Everything is up to date|Syncing|You.re offline|Your data will sync|conflict|Sync from Settings|Free plan', caseSensitive: false)).first);
    await tester.pumpAndSettle();
  }

  /// Moves the clock the app reads (timers measure against it) and lets time pass for the widget tree.
  Future<void> advance(WidgetTester tester, Duration d) async {
    clock.value = clock.value.add(d);
    await tester.pump(d);
  }
}

Future<Harness> pumpDashboard(
  WidgetTester tester, {
  Size size = const Size(420, 900),
  Future<void> Function(AppServices services)? seed,
  StubPlan? plan,
  bool online = true,
  DateTime? now,

  /// What the subscription lookup returns; null leaves it unavailable, an exception makes it fail.
  Object? subscription,

  /// For the screenshot tool: the theme to use, and a boundary to capture the whole app from.
  ThemeData? theme,
  GlobalKey? boundaryKey,

  /// Sell Pro through this store (a FakeStore), with the paywall's legal links.
  StoreBilling? store,
  PaywallText paywall = const PaywallText(),

  /// Who is signed in (default: an email account).
  AuthSession? session,

  /// Mount the app through the signed-in gate (which shows the plan wizard on a fresh account) instead of the day screen alone.
  bool throughGate = false,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final clock = ValueNotifier(now ?? DateTime(2026, 10, 3, 12));
  final cloud = FakeGateway(() => clock.value.millisecondsSinceEpoch);
  final stub = plan ?? StubPlan();
  final subscriptionHolder = <Object?>[subscription];
  final net = ManualConnectivity(online: online);
  final api = StubApi();
  final authRepo = FakeAuthRepository(initial: session ?? testSession);
  final auth = AuthController(authRepo);
  await auth.start();

  final services = AppServices(
    database: LocalDatabase.inMemory(),
    cloud: cloud,
    allowance: StubAllowance(stub),
    currentUserId: () => 'u1',
    currentEmail: () => 'a@b.co',
    connectivity: net,
    api: api,
    subscriptions: subscription == null
        ? null
        : SubscriptionService(() async {
            final current = subscriptionHolder[0];
            if (current is SubscriptionInfo) return current;
            throw current!;
          }),
    storeBilling: store,
    storeProductId: store == null ? null : 'pro_monthly',
    paywall: paywall,
    now: () => clock.value,
  );
  if (seed != null) await seed(services);

  final harness = Harness._(services, auth, authRepo, cloud, net, stub, api, clock, subscriptionHolder);
  final app = MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: theme,
    home: throughGate
        ? SignedInApp(auth: auth, session: testSession, createServices: (_) => services, openUrl: (u) async => harness.opened.add(u))
        : AppScope(
            services: services,
            child: DashboardScreen(auth: auth, openUrl: (u) async => harness.opened.add(u)),
          ),
  );
  await tester.pumpWidget(boundaryKey == null ? app : RepaintBoundary(key: boundaryKey, child: app));
  _open.add(harness);
  await services.start();
  await tester.pumpAndSettle();
  return harness;
}

final _open = <Harness>[];

/// A widget test for the app screens. The framework checks that no timer is left pending BEFORE tear-down callbacks run, and
/// the app legitimately has some (a sync debounce, the poll), so the tree is unmounted and the services disposed inside the test.
void uiTest(String description, Future<void> Function(WidgetTester tester) body, {Object? skip}) {
  testWidgets(description, skip: skip != null && skip != false, (tester) async {
    try {
      await body(tester);
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      for (final h in _open) {
        h.services.dispose();
        h.auth.dispose();
      }
      _open.clear();
      await tester.pump(const Duration(seconds: 1));
    }
  });
}

/// Taps the destructive button of an open confirmation dialog.
Future<void> confirmDangerous(WidgetTester tester, String label) async {
  await tester.tap(find.widgetWithText(FilledButton, label));
  await tester.pumpAndSettle();
}

