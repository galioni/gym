import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'api/api_client.dart';
import 'api/subscription.dart';
import 'app/app_services.dart';
import 'app/connectivity.dart';
import 'auth/auth_controller.dart';
import 'auth/auth_models.dart';
import 'auth/supabase_auth_repository.dart';
import 'billing/pro_purchases.dart';
import 'billing/store_billing.dart';
import 'core/app_config.dart';
import 'data/local_database.dart';
import 'data/postgrest_row_gateway.dart';
import 'data/postgrest_sync_allowance.dart';
import 'data/supabase_sync_signal.dart';
import 'state/theme_controller.dart';
import 'ui/auth_gate.dart';
import 'ui/signed_in_app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final AppConfig config;
  try {
    config = AppConfig.fromEnvironment();
  } on ConfigException catch (e) {
    runApp(_ConfigErrorApp(e.message));
    return;
  }

  await Supabase.initialize(url: config.supabaseUrl, publishableKey: config.supabaseAnonKey);
  final client = Supabase.instance.client;
  final authRepo = SupabaseAuthRepository(client.auth, redirectUrl: config.authRedirectUrl);
  final api = ApiClient(baseUrl: config.apiBaseUrl, tokens: authRepo);
  authRepo.onAppleAuthorization = api.linkAppleAuthorization;
  final subscriptions = SubscriptionService(api.getSubscription);
  final auth = AuthController(authRepo)..start();

  // One database for the device (not per account): the ownership check keeps one account's data from reaching another.
  final dir = await getApplicationSupportDirectory();
  final database = LocalDatabase.open('${dir.path}/daily_grind.db');
  final theme = ThemeController(database);

  // In-app purchase exists on phones only, and only once a product id is configured (see AppConfig.storeProProductId).
  final onPhone = !kIsWeb && (defaultTargetPlatform == TargetPlatform.iOS || defaultTargetPlatform == TargetPlatform.android);
  final StoreBilling? storeBilling = onPhone && config.storeProProductId.isNotEmpty ? InAppPurchaseBilling() : null;

  runApp(DailyGrindApp(
    auth: auth,
    theme: theme,
    createServices: (session) => AppServices(
      database: database,
      cloud: PostgrestRowGateway(client.rest, currentUserId: () => auth.session?.user.id ?? session.user.id),
      allowance: PostgrestSyncAllowance(client.rest),
      currentUserId: () => auth.session?.user.id,
      currentEmail: () => auth.session?.user.email,
      signal: SupabaseSyncSignal(client),
      connectivity: PlusConnectivityMonitor(),
      api: api,
      subscriptions: subscriptions,
      storeBilling: storeBilling,
      storeProductId: config.storeProProductId,
      theme: theme,
      paywall: PaywallText(period: config.storeProPeriod, termsUrl: config.termsUrl, privacyUrl: config.privacyUrl),
    ),
  ));
}

class DailyGrindApp extends StatelessWidget {
  const DailyGrindApp({super.key, required this.auth, required this.createServices, this.openUrl, this.theme});

  final AuthController auth;

  /// The light / dark / system choice; the app follows it live. Light when not given.
  final ThemeController? theme;
  final AppServices Function(AuthSession session) createServices;
  final Future<void> Function(Uri url)? openUrl;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: theme ?? const _NeverChanges(),
        builder: (context, _) => MaterialApp(
          title: 'Daily Grind',
          debugShowCheckedModeBanner: false,
          theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
          darkTheme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true, brightness: Brightness.dark),
          themeMode: theme?.mode ?? ThemeController.defaultPreference.mode,
          home: AuthGate(
            auth: auth,
            signedIn: (context, session) =>
                SignedInApp(auth: auth, session: session, createServices: createServices, openUrl: openUrl),
          ),
        ),
      );
}

class _NeverChanges implements Listenable {
  const _NeverChanges();

  @override
  void addListener(VoidCallback listener) {}

  @override
  void removeListener(VoidCallback listener) {}
}

/// Shown instead of crashing when the app was built without its configuration.
class _ConfigErrorApp extends StatelessWidget {
  const _ConfigErrorApp(this.message);

  final String message;

  @override
  Widget build(BuildContext context) => MaterialApp(
        home: Scaffold(
          body: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text('This build is missing its configuration.\n\n$message\n\nSee lib/core/app_config.dart.'),
            ),
          ),
        ),
      );
}
