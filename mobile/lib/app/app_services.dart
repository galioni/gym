/// Builds and connects everything the signed-in app runs on: local storage, the sync engine, the screens' state, and the
/// automatic sync that keeps the two in step. One place, so the wiring is the same in the app and in the tests.
library;

import 'dart:async';

import 'package:flutter/widgets.dart';

import '../api/api_client.dart';
import '../api/plan_generation.dart';
import '../api/subscription.dart';
import '../billing/pro_purchases.dart';
import '../billing/store_billing.dart';
import '../data/postgres_repositories.dart';
import '../data/local_database.dart';
import '../data/row_gateway.dart';
import '../data/sqlite_repositories.dart';
import '../data/sync_owner.dart';
import '../state/ai_settings.dart';
import '../state/auto_sync.dart';
import '../state/day_timers.dart';
import '../state/sync_controller.dart';
import '../state/theme_controller.dart';
import '../state/workout_tracker.dart';
import '../state/workspace.dart';
import '../sync/sync_allowance.dart';
import '../sync/sync_service.dart';
import '../sync/sync_signal.dart';
import 'app_events.dart';
import 'connectivity.dart';

class AppServices {
  AppServices({
    required this.database,
    required RowGateway cloud,
    required SyncAllowance allowance,
    required String? Function() currentUserId,
    SyncSignal? signal,
    ConnectivityMonitor? connectivity,
    this.api,
    this.subscriptions,
    StoreBilling? storeBilling,
    String? storeProductId,
    PaywallText paywall = const PaywallText(),
    ThemeController? theme,
    String? Function()? currentEmail,
    DateTime Function() now = DateTime.now,
  })  : _currentUserId = currentUserId,
        _currentEmail = currentEmail ?? (() => null),
        clock = now,
        theme = theme ?? ThemeController.inMemory(),
        connectivity = connectivity ?? ManualConnectivity() {
    workoutRepo = SqliteWorkoutDataRepository(database, now: now);
    templateRepo = SqliteTemplateRepository(database, now: now);
    plansRepo = SqlitePlansRepository(database, now: now);
    accountRepo = SqliteAccountSettingsRepository(database, now: now);
    syncSettingsRepo = SqliteSyncSettingsRepository(database);
    owner = SqliteSyncOwner(database);

    syncService = SyncService(
      settingsRepository: syncSettingsRepo,
      allowance: allowance,
      ownership: SyncOwnerGuard(owner, currentUserId),
      localWorkoutRepository: workoutRepo,
      localTemplateRepository: templateRepo,
      localPlansRepository: plansRepo,
      localSettingsRepository: accountRepo,
      cloudWorkoutRepository: PostgresWorkoutDataRepository(cloud, now: now),
      cloudTemplateRepository: PostgresTemplateRepository(cloud, now: now),
      cloudPlansRepository: PostgresPlansRepository(cloud, now: now),
      cloudSettingsRepository: PostgresAccountSettingsRepository(cloud, now: now),
      now: now,
    );

    workspace = Workspace(templates: templateRepo, plans: plansRepo, account: accountRepo, now: now);
    aiSettings = AiSettings(api);
    final billingApi = api;
    if (storeBilling != null && storeProductId != null && storeProductId.isNotEmpty && billingApi != null) {
      purchases = ProPurchases(
        billing: storeBilling,
        productId: storeProductId,
        verify: (platform, token) => billingApi.verifyStorePurchase(platform.wire, token),
        currentUserId: currentUserId,
        paywall: paywall,
        onSubscriptionChanged: () {
          subscriptions?.invalidate();
          subscriptionRevision.value++;
        },
      );
    }
    tracker = WorkoutTracker(store: workoutRepo, templates: () => workspace.templates, now: now);
    timers = DayTimers(tracker, now: now);
    sync = SyncController(syncService);
    allowanceState = AllowanceState(allowance);

    autoSync = AutoSync(
      syncNow: ({bool automatic = false, bool downloadOnly = false}) =>
          sync.syncNow(automatic: automatic, downloadOnly: downloadOnly),
      onLocalDataChanged: () => unawaited(reloadFromStorage()),
      onConflicts: (c) => _emit(ConflictsFound(c)),
      onStorageLimit: (m) => _emit(StorageLimitReached(m)),
      onOwnerMismatch: () => _emit(const OwnerMismatch()),
      hasOwnerMismatch: (userId) => owner.check(userId) == OwnerCheck.mismatch,
      signal: signal,
      now: now,
    );

    for (final n in [tracker, workspace, allowanceState, sync]) {
      n.addListener(_inputsChanged);
    }
    _lastAllData = tracker.allData;
    online = ValueNotifier<bool>(this.connectivity.isOnline);
    _connectivitySub = this.connectivity.changes.listen((isOnline) {
      online.value = isOnline;
      autoSync.setOnline(isOnline);
    });
    autoSync.setOnline(this.connectivity.isOnline);
  }

  final LocalDatabase database;
  final ConnectivityMonitor connectivity;

  /// The server API (plan, account deletion). Null where there is none (tests).
  final ApiClient? api;
  final SubscriptionService? subscriptions;

  /// The current time the whole app uses (the injected one in tests), so screens never read the system clock behind its back.
  final DateTime Function() clock;

  /// Light, dark or system. Lives with the device, not the account, so it is the same before and after sign-in.
  final ThemeController theme;

  /// Buying Pro through the App Store / Google Play. Null where there is no store (desktop, tests) or it is not configured.
  ProPurchases? purchases;

  /// Bumped when the account's plan may have changed (a purchase was accepted), so the Settings card reads it again.
  final subscriptionRevision = ValueNotifier<int>(0);
  final String? Function() _currentUserId;
  final String? Function() _currentEmail;

  /// The signed-in user's id and email (null when signed out).
  String? get signedInUserId => _currentUserId();
  String? get signedInEmail => _currentEmail();

  late final SqliteWorkoutDataRepository workoutRepo;
  late final SqliteTemplateRepository templateRepo;
  late final SqlitePlansRepository plansRepo;
  late final SqliteAccountSettingsRepository accountRepo;
  late final SqliteSyncSettingsRepository syncSettingsRepo;
  late final SqliteSyncOwner owner;
  late final SyncService syncService;
  late final Workspace workspace;
  late final WorkoutTracker tracker;
  late final DayTimers timers;
  late final SyncController sync;
  late final AllowanceState allowanceState;
  late final AutoSync autoSync;
  late final AiSettings aiSettings;

  /// Whether the account's first-run setup (the plan wizard) is done. Per device, not synced: running the wizard again clears it
  /// on purpose, and a synced flag would let another device dismiss the wizard halfway through.
  final onboarded = ValueNotifier<bool>(false);
  static const _onboardedKey = 'onboarded';

  /// Whether the device has a connection, for the offline banner and the sync status.
  late final ValueNotifier<bool> online;

  final _events = StreamController<AppEvent>.broadcast();
  StreamSubscription<bool>? _connectivitySub;
  Map<String, Object?> _lastAllData = const {};
  int _lastWorkspaceRevision = 0;
  Object? _lastSyncedAt;
  bool _started = false;
  bool _disposed = false;

  /// What the app wants to tell the user (conflicts, a full account, another account's data).
  Stream<AppEvent> get events => _events.stream;

  void _emit(AppEvent event) {
    if (!_disposed) _events.add(event);
  }

  /// Loads local data and starts syncing for [userId]. Call once after sign-in, and [userChanged] if the account changes.
  Future<void> start() async {
    if (_started) return;
    _started = true;
    await Future.wait([workspace.load(), tracker.load(), sync.load()]);
    await _resolveOnboarded();
    tracker.applyScheduledSession(workspace.activePlan);
    unawaited(aiSettings.load());
    unawaited(purchases?.start());
    autoSync.start();
    await userChanged();
  }

  /// The signed-in account changed (or was first seen): read its plan's sync allowance and let the automatic sync begin.
  Future<void> userChanged() async {
    await allowanceState.refresh(_currentUserId());
    _configureAutoSync();
  }

  /// Local storage changed underneath the screens (a sync wrote to it): read it again.
  Future<void> reloadFromStorage() async {
    await Future.wait([workspace.load(), tracker.reload()]);
    await _markOnboardedIfDataExists();
    tracker.applyScheduledSession(workspace.activePlan);
  }

  /// This device's setup flag, except that templates or workouts already in storage (from an earlier install, or arriving from the
  /// cloud) mean the account is set up: the wizard is skipped.
  Future<void> _resolveOnboarded() async {
    onboarded.value = database.readDoc(_onboardedKey) == true;
    await _markOnboardedIfDataExists();
  }

  /// Not while the wizard is open to rebuild a plan: that must not be dismissed just because data is present or arrived.
  Future<void> _markOnboardedIfDataExists() async {
    if (onboarded.value || isRebuildingPlan) return;
    if (await templateRepo.readSnapshot() != null || await workoutRepo.readSnapshot() != null) _setOnboarded(true);
  }

  void _setOnboarded(bool value) {
    database.writeDoc(_onboardedKey, value);
    onboarded.value = value;
  }

  /// The wizard is open to regenerate an existing plan (the account already has plan details).
  bool get isRebuildingPlan => !onboarded.value && workspace.planParams != null;

  /// Stores a generated plan as the account's templates and remembers what it was generated from.
  Future<void> completeOnboarding(GeneratedPlan plan, PlanParams params) async {
    await workspace.replaceTemplates(plan.templates);
    await workspace.savePlanDetails(params.toJson(), plan.meta);
    _setOnboarded(true);
    tracker.applyScheduledSession(workspace.activePlan);
  }

  /// Leave the wizard without generating anything (the templates stay as they are).
  void skipOnboarding() => _setOnboarded(true);

  /// Open the wizard again to replace the templates with a new generated plan.
  void startPlanRebuild() => _setOnboarded(false);

  void _inputsChanged() {
    if (_disposed) return;
    // The plan's allowance is read again after every sync, so the screen shows the next date.
    final syncedAt = sync.settings.lastSyncedAt;
    if (!sync.isSyncing && syncedAt != _lastSyncedAt) {
      _lastSyncedAt = syncedAt;
      unawaited(allowanceState.refresh(_currentUserId()));
    }
    // Edits (not the "Saving" flicker) schedule a sync soon: to days, or to templates, plans and the active plan.
    if (!identical(tracker.allData, _lastAllData) || workspace.revision != _lastWorkspaceRevision) {
      _lastAllData = tracker.allData;
      _lastWorkspaceRevision = workspace.revision;
      autoSync.localChanged();
    }
    _configureAutoSync();
  }

  /// A Free account uploads by hand, once a month. Apart from that it gets one automatic sync on a device that has never
  /// synced, and that one only DOWNLOADS (so a new device restores right away without spending the month). Everyone else
  /// syncs automatically. It waits for the plan before deciding.
  void _configureAutoSync() {
    final limited = allowanceState.isLimited;
    autoSync.configure(
      ready: tracker.isLoaded &&
          workspace.isLoaded &&
          allowanceState.loaded &&
          (!limited || sync.settings.lastSyncedAt == null),
      userId: _currentUserId(),
      downloadOnly: limited,
    );
  }

  /// The user chose to take this device over for the signed-in account: the other account's data is removed from it.
  Future<void> switchOwnerToCurrentUser() async {
    final userId = _currentUserId();
    if (userId == null) return;
    owner.switchOwner(userId);
    autoSync.ownerResolved();
    await Future.wait([workspace.load(), tracker.reload(), sync.load()]);
    await _resolveOnboarded();
    _configureAutoSync();
  }

  /// Removes all of this device's data (the account is being deleted) and empties what the screens show.
  Future<void> wipeLocalData() async {
    owner.clearAll();
    onboarded.value = false;
    await Future.wait([workspace.load(), tracker.reload(), sync.load()]);
  }

  /// The app moved between foreground and background.
  void lifecycleChanged(AppLifecycleState state) {
    final foreground = state == AppLifecycleState.resumed;
    if (!foreground) {
      timers.saveAll();
      unawaited(tracker.flush());
    }
    autoSync.setForeground(foreground);
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _connectivitySub?.cancel();
    autoSync.dispose();
    for (final n in [tracker, workspace, allowanceState, sync]) {
      n.removeListener(_inputsChanged);
    }
    timers.dispose();
    tracker.dispose();
    workspace.dispose();
    purchases?.dispose();
    subscriptionRevision.dispose();
    aiSettings.dispose();
    onboarded.dispose();
    sync.dispose();
    allowanceState.dispose();
    connectivity.dispose();
    online.dispose();
    _events.close();
  }
}
