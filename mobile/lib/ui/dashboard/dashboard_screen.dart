import 'dart:async';

import 'package:flutter/material.dart';

import '../../app/app_events.dart';
import '../../app/app_services.dart';
import '../../auth/auth_controller.dart';
import '../../domain/dates.dart';
import '../../domain/session_types.dart';
import '../../domain/week_plan.dart';
import '../../domain/workout_transitions.dart';
import '../../sync/sync_status.dart';
import '../app_scope.dart';
import '../feedback.dart';
import '../history/history_screen.dart';
import '../settings/settings_screen.dart';
import 'daily_check_card.dart';
import 'date_bar.dart';
import 'progress_footer.dart';
import 'session_picker.dart';
import 'sync_status_chip.dart';
import 'week_plan_bar.dart';
import 'workout_section_card.dart';

enum _MenuAction { copyYesterday, clearDay, history, settings, signOut }

/// The day screen: pick a day and a session, tick exercises off, time the sections, write notes.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key, required this.auth, this.openUrl});

  final AuthController auth;

  /// Replaces opening links in the browser (tests).
  final Future<void> Function(Uri url)? openUrl;

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final _warmupKey = GlobalKey();
  final _mainKey = GlobalKey();
  StreamSubscription<AppEvent>? _events;
  AppServices? _services;
  bool _ownerPromptOpen = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final services = AppScope.of(context);
    if (!identical(services, _services)) {
      _events?.cancel();
      _services = services;
      _events = services.events.listen(_onEvent);
    }
  }

  @override
  void dispose() {
    _events?.cancel();
    super.dispose();
  }

  void _openHistory() {
    final services = _services!;
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => AppScope(services: services, child: HistoryScreen(now: services.clock)),
    ));
  }

  void _openSettings() {
    final services = _services!;
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => AppScope(services: services, child: SettingsScreen(auth: widget.auth, openUrl: widget.openUrl)),
    ));
  }

  Future<void> _onEvent(AppEvent event) async {
    if (!mounted) return;
    switch (event) {
      case ConflictsFound():
        showToast(
          context,
          'Sync needs your attention',
          description: 'The same day was changed on two devices. Choose which version to keep.',
          actionLabel: 'Review',
          onAction: _openSettings,
          duration: const Duration(seconds: 10),
        );
      case StorageLimitReached(:final message):
        showToast(context, 'Cloud storage limit reached', description: message, tone: ToastTone.error, duration: const Duration(seconds: 15));
      case OwnerMismatch():
        if (_ownerPromptOpen) return; // two places can notice it; only one question may be open
        _ownerPromptOpen = true;
        final switchAccount = await confirmDialog(
          context,
          title: "Another account's data is on this device",
          description:
              "Nothing is synced until you choose, so the two accounts stay separate. Switching removes the other account's workouts from this device (they remain in that account's cloud).",
          confirmLabel: 'Switch to this account',
          cancelLabel: 'Sign out',
          danger: true,
        );
        _ownerPromptOpen = false;
        if (!mounted) return;
        if (switchAccount) {
          await _services!.switchOwnerToCurrentUser();
        } else {
          await widget.auth.signOut();
        }
    }
  }

  Future<bool> _deleteItem(WorkoutSection section, String id) async {
    final confirmed = await confirmDialog(
      context,
      title: 'Remove exercise?',
      description: 'This action removes the item from your current workout list.',
      confirmLabel: 'Delete',
      danger: true,
    );
    if (!confirmed || !mounted) return false;
    _services!.tracker.deleteItem(section, id);
    showToast(context, 'Exercise removed');
    return true;
  }

  Future<void> _clearDay() async {
    final confirmed = await confirmDialog(
      context,
      title: 'Clear all day data?',
      description: 'This removes workout entries, notes, and checks for the selected day.',
      confirmLabel: 'Clear Day',
      danger: true,
    );
    if (!confirmed || !mounted) return;
    _services!.tracker.clearCurrentDay();
    showToast(context, 'Day cleared', tone: ToastTone.success);
  }

  void _copyYesterday() {
    final copied = _services!.tracker.duplicatePreviousDayNotesAndWeight();
    if (copied) {
      showToast(context, 'Previous notes and weight duplicated', tone: ToastTone.success);
    } else {
      showToast(context, 'Nothing to duplicate', description: 'No previous day notes or weight were found.');
    }
  }

  void _goToTimer(WorkoutSection section) {
    final context = (section == WorkoutSection.warmup ? _warmupKey : _mainKey).currentContext;
    if (context != null) Scrollable.ensureVisible(context, duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
  }

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    final tracker = services.tracker;
    final workspace = services.workspace;

    return ListenableBuilder(
      listenable: Listenable.merge([tracker, workspace, services.sync, services.allowanceState, services.timers, services.online]),
      builder: (context, _) {
        final day = tracker.currentDay;
        final options = workspace.sessionOptions;
        final plan = workspace.activePlan;
        final syncStatus = deriveSyncStatus(
          isSyncing: services.sync.isSyncing,
          isOnline: services.online.value,
          conflictCount: services.sync.conflicts.length,
          lastError: services.sync.settings.lastError,
          lastSyncedAt: services.sync.settings.lastSyncedAt,
          allowance: services.allowanceState.isLimited
              ? (nextAvailableAt: services.allowanceState.status?.nextAvailableAt)
              : null,
        );
        final label = options.where((o) => o.value == day.sessionType).firstOrNull?.label ?? getSessionLabel(day.sessionType);
        final option = options.where((o) => o.value == day.sessionType).firstOrNull;
        final videoUrl = workspace.videoUrlFor(day.sessionType);
        final weekPlan = plan == null
            ? null
            : buildWeekPlan(plan: plan, allData: tracker.allData, currentDate: tracker.currentDate, currentSessionType: day.sessionType);

        Widget warmup() => KeyedSubtree(
              key: _warmupKey,
              child: WorkoutSectionCard(
                title: 'Warm-up',
                items: day.warmup,
                timer: services.timers.warmup,
                notes: day.warmupNotes,
                openUrl: widget.openUrl,
                onToggleItem: (id, done) => tracker.toggleItem(WorkoutSection.warmup, id, done),
                onDeleteItem: (id) => _deleteItem(WorkoutSection.warmup, id),
                onNotesChanged: (t) => tracker.updateDayDebounced((d) => d.copyWith(warmupNotes: t)),
              ),
            );
        Widget main() => KeyedSubtree(
              key: _mainKey,
              child: WorkoutSectionCard(
                title: 'Main Session',
                items: day.main,
                timer: services.timers.main,
                notes: day.mainNotes,
                openUrl: widget.openUrl,
                onToggleItem: (id, done) => tracker.toggleItem(WorkoutSection.main, id, done),
                onDeleteItem: (id) => _deleteItem(WorkoutSection.main, id),
                onNotesChanged: (t) => tracker.updateDayDebounced((d) => d.copyWith(mainNotes: t)),
              ),
            );

        return Scaffold(
          appBar: AppBar(
            title: const Text('Daily Grind'),
            actions: [
              IconButton(tooltip: 'History', icon: const Icon(Icons.history), onPressed: _openHistory),
              SyncStatusChip(status: syncStatus, onTap: _openSettings),
              PopupMenuButton<_MenuAction>(
                tooltip: 'Menu',
                onSelected: (a) async {
                  switch (a) {
                    case _MenuAction.copyYesterday:
                      _copyYesterday();
                    case _MenuAction.clearDay:
                      await _clearDay();
                    case _MenuAction.history:
                      _openHistory();
                    case _MenuAction.settings:
                      _openSettings();
                    case _MenuAction.signOut:
                      await widget.auth.signOut();
                  }
                },
                itemBuilder: (_) => [
                  const PopupMenuItem(value: _MenuAction.copyYesterday, child: Text("Copy yesterday's notes & weight")),
                  const PopupMenuItem(value: _MenuAction.clearDay, child: Text('Clear day')),
                  const PopupMenuDivider(),
                  const PopupMenuItem(value: _MenuAction.history, child: Text('History')),
                  const PopupMenuItem(value: _MenuAction.settings, child: Text('Settings')),
                  PopupMenuItem(value: _MenuAction.signOut, child: Text('Sign out${widget.auth.session?.user.email == null ? '' : ' (${widget.auth.session!.user.email})'}')),
                ],
              ),
            ],
          ),
          body: Column(
            children: [
              OfflineBanner(online: services.online),
              Expanded(
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 1000),
                    child: LayoutBuilder(
                      builder: (context, box) {
                        final wide = box.maxWidth >= 720;
                        return ListView(
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                          children: [
                            DateBar(dateKey: tracker.currentDate, todayKey: tracker.todayKey, onSelect: tracker.setCurrentDate),
                            const SizedBox(height: 12),
                            SessionPicker(options: options, selected: day.sessionType, onChanged: tracker.changeSessionType),
                            const SizedBox(height: 16),
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.center,
                              children: [
                                Flexible(child: Text(label, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700))),
                                if (option?.source == 'ai') ...[
                                  const SizedBox(width: 8),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      border: Border.all(color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.4)),
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: Text('AI', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: Theme.of(context).colorScheme.primary)),
                                  ),
                                ],
                                if (videoUrl != null && videoUrl.isNotEmpty) ...[
                                  const SizedBox(width: 8),
                                  TextButton.icon(
                                    onPressed: () async {
                                      final uri = Uri.tryParse(videoUrl);
                                      if (uri != null && widget.openUrl != null) await widget.openUrl!(uri);
                                    },
                                    icon: const Icon(Icons.smart_display_outlined, size: 16),
                                    label: const Text('Watch'),
                                  ),
                                ],
                              ],
                            ),
                            if (option?.focus != null && option!.focus!.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(top: 2),
                                child: Text(option.focus!, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
                              ),
                            if (weekPlan != null)
                              Padding(
                                padding: const EdgeInsets.only(top: 10),
                                child: WeekPlanBar(
                                  view: weekPlan,
                                  labelFor: (t) => options.where((o) => o.value == t).firstOrNull?.label ?? getSessionLabel(t),
                                  onSelectSession: tracker.changeSessionType,
                                ),
                              ),
                            const SizedBox(height: 16),
                            if (wide)
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(child: warmup()),
                                  const SizedBox(width: 16),
                                  Expanded(child: main()),
                                ],
                              )
                            else ...[
                              warmup(),
                              const SizedBox(height: 16),
                              main(),
                            ],
                            const SizedBox(height: 16),
                            DailyCheckCard(
                              weight: day.weight,
                              checkNotes: day.checkNotes,
                              onWeight: (w) => tracker.updateDayDebounced((d) => d.copyWith(weight: w)),
                              onCheckNotes: (t) => tracker.updateDayDebounced((d) => d.copyWith(checkNotes: t)),
                            ),
                          ],
                        );
                      },
                    ),
                  ),
                ),
              ),
            ],
          ),
          bottomNavigationBar: ProgressFooter(
            percent: dayProgress(day),
            isSaving: tracker.isSaving,
            saveError: tracker.lastSaveError,
            onClear: _clearDay,
            runningSection: services.timers.runningSection,
            onGoToTimer: () {
              final s = services.timers.runningSection;
              if (s != null) _goToTimer(s);
            },
          ),
        );
      },
    );
  }
}
