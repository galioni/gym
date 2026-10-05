import 'package:flutter/material.dart';

import '../../domain/plan_text.dart';
import '../../sync/conflict_text.dart';
import '../../sync/sync_allowance.dart';
import '../../sync/sync_merge.dart' show ConflictResolution;
import '../../sync/sync_status.dart';
import '../../sync/sync_types.dart';
import '../app_scope.dart';
import '../dashboard/sync_status_chip.dart';
import '../feedback.dart';

String _two(int n) => n.toString().padLeft(2, '0');
const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

/// "3 Oct 2026, 14:05" in the reader's time zone.
String formatDateTime(String iso) {
  final d = DateTime.parse(iso).toLocal();
  return '${d.day} ${_months[d.month - 1]} ${d.year}, ${_two(d.hour)}:${_two(d.minute)}';
}

/// Everything about sync in Settings: status, "Sync now", conflicts to decide, and the restore points. The wording is the web
/// app's (`SyncSettingsPanel.tsx`).
class SyncPanel extends StatefulWidget {
  const SyncPanel({super.key, this.now});

  /// The current time (tests).
  final DateTime Function()? now;

  @override
  State<SyncPanel> createState() => _SyncPanelState();
}

class _SyncPanelState extends State<SyncPanel> {
  final _resolutions = <SyncEntity, ConflictResolution>{};

  DateTime _now() => (widget.now ?? AppScope.of(context).clock)();

  void _toast(SyncNowResult result, SyncAllowanceStatus? allowance) {
    switch ((result.status, result.reason)) {
      case (SyncOutcome.success, _):
        showToast(context, result.message.isEmpty ? 'Sync completed' : result.message, tone: ToastTone.success);
      case (SyncOutcome.conflict, _):
        showToast(context, 'Conflict resolution required', description: result.message);
      case (SyncOutcome.error, SyncFailReason.allowance):
        showToast(
          context,
          "This month's sync has been used",
          description: result.nextAvailableAt != null
              ? 'Nothing is lost: your data is safe on this device. The next sync is available on ${formatNextSync(result.nextAvailableAt!)}.'
              : 'Nothing is lost: your data is safe on this device.',
        );
      case (SyncOutcome.error, _):
        showToast(context, 'Sync failed', description: result.message, tone: ToastTone.error);
      case _:
        break;
    }
  }

  Future<void> _syncNow(AllowanceStateView limit) async {
    final services = AppScope.of(context);
    final sync = services.sync;
    final hasConflicts = sync.conflicts.isNotEmpty;
    // Starting a sync opens the month's window, so say so before it happens. Inside an open window it is the same sync.
    if (limit.limited && limit.status?.windowEndsAt == null) {
      final nextOpens = _now().add(const Duration(days: 30)).toUtc().toIso8601String();
      final go = await confirmDialog(
        context,
        title: "Use this month's sync?",
        description:
            'The Free plan syncs once every 30 days, in both directions. Syncing now uses it, and the next sync will be available on ${formatNextSync(nextOpens)}. Pro syncs automatically and without limit.',
        confirmLabel: 'Sync now',
        cancelLabel: 'Not now',
      );
      if (!go || !mounted) return;
    }
    try {
      final result = await sync.syncNow(resolution: hasConflicts ? Map.of(_resolutions) : const {});
      if (!mounted) return;
      if (result.appliedToLocal == true) await services.reloadFromStorage();
      if (!mounted) return;
      if (result.status != SyncOutcome.conflict) _resolutions.clear();
      _toast(result, limit.status);
    } catch (e) {
      if (mounted) showToast(context, 'Sync failed', description: '$e', tone: ToastTone.error);
    }
  }

  Future<void> _rollback(String id) async {
    final services = AppScope.of(context);
    final result = await services.sync.rollbackTo(id);
    if (!mounted) return;
    if (result.status == SyncOutcome.success) {
      await services.reloadFromStorage();
      if (mounted) showToast(context, 'Rollback complete', tone: ToastTone.success);
    } else {
      showToast(context, 'Rollback failed', description: result.message, tone: ToastTone.error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return ListenableBuilder(
      listenable: Listenable.merge([services.sync, services.allowanceState, services.online]),
      builder: (context, _) {
        final sync = services.sync;
        final allowance = services.allowanceState;
        final limited = allowance.isLimited;
        final status = allowance.status;
        final syncAvailable = canSyncNow(status);
        final conflicts = sync.conflicts;
        final lastError = sync.settings.lastError;
        final lastSyncedAt = sync.settings.lastSyncedAt;
        final signedIn = services.signedInEmail != null;
        final syncStatus = deriveSyncStatus(
          isSyncing: sync.isSyncing,
          isOnline: services.online.value,
          conflictCount: conflicts.length,
          lastError: lastError,
          lastSyncedAt: lastSyncedAt,
          allowance: limited ? (nextAvailableAt: status?.nextAvailableAt) : null,
          now: _now(),
        );
        // The red banner below carries the error text; the headline only summarises it.
        final headline = lastError != null && syncStatus.detail == lastError
            ? 'Sync hit a problem. Your data is safe on this device.'
            : syncStatus.detail;
        final message = sync.message;
        final showMessage = message.isNotEmpty && message != lastError && conflicts.isEmpty && message != 'Sync completed.';
        final canResolve = conflicts.every((c) => _resolutions.containsKey(c.entity));
        final limit = AllowanceStateView(limited: limited, status: status);

        return Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Expanded(child: Text('Sync Settings', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700))),
                  FilledButton.tonalIcon(
                    onPressed: sync.isSyncing || !signedIn || (conflicts.isNotEmpty && !canResolve) || (limited && !syncAvailable)
                        ? null
                        : () => _syncNow(limit),
                    icon: sync.isSyncing
                        ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.sync, size: 16),
                    label: Text(sync.isSyncing ? 'Syncing...' : 'Sync now'),
                  ),
                ]),
                const SizedBox(height: 14),
                _Box(
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    SyncStatusChip(status: syncStatus, onTap: () {}),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(limited ? 'Free plan: one sync every 30 days' : 'Your data syncs automatically', style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
                        Text(headline, style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
                        Text(
                          '${signedIn ? 'Signed in as ${services.signedInEmail}' : 'Not signed in — sync disabled'}${lastSyncedAt != null ? ' · last sync ${formatDateTime(lastSyncedAt)}' : ''}',
                          style: theme.textTheme.bodySmall?.copyWith(color: scheme.outline),
                        ),
                      ]),
                    ),
                  ]),
                ),
                if (limited) ...[
                  const SizedBox(height: 12),
                  _Box(
                    child: Text(
                      '${syncAvailable ? 'A sync is available now. It sends and receives your changes in one go, then the next opens in 30 days.' : 'Your sync for this period has been used. The next one is available on ${formatNextSync(status?.nextAvailableAt ?? _now().toUtc().toIso8601String())}.'} The cloud keeps your last 7 days; older entries stay on this device.',
                      style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ),
                ],
                if (showMessage) ...[
                  const SizedBox(height: 12),
                  _Box(child: Text(message, style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant))),
                ],
                if (lastError != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: scheme.errorContainer.withValues(alpha: 0.4), borderRadius: BorderRadius.circular(12), border: Border.all(color: scheme.error.withValues(alpha: 0.4))),
                    child: Text(lastError, style: theme.textTheme.bodySmall?.copyWith(color: scheme.error)),
                  ),
                ],
                if (conflicts.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  for (final conflict in conflicts) _ConflictCard(
                    conflict: conflict,
                    now: _now(),
                    chosen: _resolutions[conflict.entity],
                    onChoose: (r) => setState(() => _resolutions[conflict.entity] = r),
                  ),
                  Wrap(
                    spacing: 12,
                    runSpacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      FilledButton.icon(
                        onPressed: sync.isSyncing || !canResolve ? null : () => _syncNow(limit),
                        icon: const Icon(Icons.sync, size: 16),
                        label: const Text('Apply choices and sync'),
                      ),
                      if (!canResolve) Text('Choose a version for each conflict above.', style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
                    ],
                  ),
                ],
                if (sync.restorePoints.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  _Box(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('Safety snapshots', style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
                      Text(
                        'Saved automatically before a sync that changes your data. Roll back if a sync overwrote something you wanted to keep.',
                        style: theme.textTheme.bodySmall?.copyWith(color: scheme.outline),
                      ),
                      if (sync.restorePoints.length > 1)
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton(onPressed: sync.pruneRestorePoints, child: const Text('Keep newest only')),
                        ),
                      const SizedBox(height: 8),
                      for (final point in sync.restorePoints)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Row(children: [
                            Expanded(child: Text(formatDateTime(point['createdAt'] as String), style: theme.textTheme.bodySmall)),
                            TextButton(onPressed: () => _rollback(point['id'] as String), child: const Text('Rollback')),
                          ]),
                        ),
                    ]),
                  ),
                ],
                const SizedBox(height: 8),
                Text(freePlanSummaryHint(limited), style: theme.textTheme.bodySmall?.copyWith(color: scheme.outline)),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// A one-line pointer under the panel: only a Free account needs reminding what Pro changes.
String freePlanSummaryHint(bool limited) => limited ? freePlanSummary : '';

class AllowanceStateView {
  const AllowanceStateView({required this.limited, required this.status});

  final bool limited;
  final SyncAllowanceStatus? status;
}

class _Box extends StatelessWidget {
  const _Box({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        ),
        child: child,
      );
}

class _ConflictCard extends StatelessWidget {
  const _ConflictCard({required this.conflict, required this.now, required this.chosen, required this.onChoose});

  final SyncConflict conflict;
  final DateTime now;
  final ConflictResolution? chosen;
  final ValueChanged<ConflictResolution> onChoose;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final label = entityLabel(conflict.entity);
    final localNewer = conflict.localUpdatedAt.compareTo(conflict.cloudUpdatedAt) >= 0;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.tertiaryContainer.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.tertiary.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$label conflict', style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
          Text(
            'This device ${relativeTime(conflict.localUpdatedAt, now)} · Cloud ${relativeTime(conflict.cloudUpdatedAt, now)} · ${localNewer ? 'This device is newer' : 'Cloud is newer'}',
            style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
          if (conflict.previewPaths.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text('WHAT DIFFERS', style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 1.2, fontWeight: FontWeight.w700, color: scheme.outline)),
            for (final path in conflict.previewPaths) Text(formatConflictPath(conflict.entity, path), style: theme.textTheme.bodySmall),
          ],
          const SizedBox(height: 10),
          Wrap(spacing: 8, children: [
            ChoiceChip(
              label: const Text('Keep this device'),
              selected: chosen == ConflictResolution.keepLocal,
              onSelected: (_) => onChoose(ConflictResolution.keepLocal),
            ),
            ChoiceChip(
              label: const Text('Keep cloud'),
              selected: chosen == ConflictResolution.keepCloud,
              onSelected: (_) => onChoose(ConflictResolution.keepCloud),
            ),
          ]),
          if (chosen != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                chosen == ConflictResolution.keepLocal
                    ? "This device's version wins for overlapping changes. Any cloud-only changes are preserved."
                    : 'Cloud version wins for overlapping changes. Any local-only changes are preserved.',
                style: theme.textTheme.bodySmall?.copyWith(color: scheme.outline),
              ),
            ),
        ],
      ),
    );
  }
}
