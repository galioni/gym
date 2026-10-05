import 'package:flutter/material.dart';

import '../api/plan_generation.dart';
import '../app/app_services.dart';
import '../auth/auth_controller.dart';
import '../auth/auth_models.dart';
import 'app_scope.dart';
import 'dashboard/dashboard_screen.dart';
import 'onboarding/onboarding_screen.dart';

/// Builds the services for the account that just signed in, waits for local data to load, then shows the day screen. The
/// services are torn down when the account signs out or another one signs in.
class SignedInApp extends StatefulWidget {
  const SignedInApp({super.key, required this.auth, required this.session, required this.createServices, this.openUrl});

  final AuthController auth;
  final AuthSession session;

  /// Builds everything the signed-in app runs on (see `AppServices`); a function so tests can supply a fake backend.
  final AppServices Function(AuthSession session) createServices;
  final Future<void> Function(Uri url)? openUrl;

  @override
  State<SignedInApp> createState() => _SignedInAppState();
}

class _SignedInAppState extends State<SignedInApp> with WidgetsBindingObserver {
  late final AppServices _services = widget.createServices(widget.session);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _services.start();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) => _services.lifecycleChanged(state);

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _services.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AppScope(
        services: _services,
        child: ListenableBuilder(
          listenable: Listenable.merge([_services.tracker, _services.workspace, _services.onboarded]),
          builder: (context, _) {
            if (!_services.tracker.isLoaded || !_services.workspace.isLoaded) {
              return const Scaffold(body: Center(child: CircularProgressIndicator()));
            }
            if (!_services.onboarded.value) {
              return OnboardingScreen(initial: PlanParams.tryFromJson(_services.workspace.planParams));
            }
            return DashboardScreen(auth: widget.auth, openUrl: widget.openUrl);
          },
        ),
      );
}
