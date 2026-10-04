import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

import '../../domain/dates.dart';
import '../../domain/history_stats.dart';
import '../../domain/models.dart';
import '../../domain/session_types.dart';
import '../app_scope.dart';
import '../feedback.dart';
import 'weight_chart.dart';

/// Everything logged so far: streak and totals, body weight over time, and every day with something in it, newest week first.
/// Tap a day to open it; swipe it away to remove it.
class HistoryScreen extends StatelessWidget {
  const HistoryScreen({super.key, this.now});

  /// The current time (tests).
  final DateTime Function()? now;

  Future<void> _remove(BuildContext context, String dateKey) async {
    final tracker = AppScope.of(context).tracker;
    final confirmed = await confirmDialog(
      context,
      title: 'Remove this day from your history?',
      description: 'Its workout, notes and weight are deleted. With sync on, it is removed from your other devices too.',
      confirmLabel: 'Remove',
      danger: true,
    );
    if (!confirmed || !context.mounted) return;
    tracker.deleteDay(dateKey);
    showToast(context, 'Day removed from history');
  }

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Workout History')),
      body: ListenableBuilder(
        listenable: Listenable.merge([services.tracker, services.workspace]),
        builder: (context, _) {
          final all = services.tracker.allData;
          final clock = (now ?? DateTime.now)();
          final theme = Theme.of(context);
          final scheme = theme.colorScheme;
          final groups = groupByWeek(all);
          final hasWeight = all.values.any((d) => d.weight.trim().isNotEmpty);
          final labels = {for (final o in services.workspace.allSessionOptions) o.value: o.label};

          return Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 800),
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                children: [
                  Row(children: [
                    Expanded(child: _StatCard(icon: Icons.local_fire_department_outlined, value: '${calcStreak(all, clock)}', label: 'Day streak')),
                    const SizedBox(width: 12),
                    Expanded(child: _StatCard(icon: Icons.fitness_center, value: '${all.values.where(hasCompletedItems).length}', label: 'Total workouts')),
                    const SizedBox(width: 12),
                    Expanded(child: _StatCard(icon: Icons.event_available_outlined, value: '${thisWeekCount(all, clock)}', label: 'This week')),
                  ]),
                  if (hasWeight) ...[
                    const SizedBox(height: 16),
                    Card(
                      margin: EdgeInsets.zero,
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('BODY WEIGHT', style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 1.4, fontWeight: FontWeight.w700, color: scheme.outline)),
                          const SizedBox(height: 12),
                          WeightChart(allData: all),
                        ]),
                      ),
                    ),
                  ],
                  const SizedBox(height: 20),
                  if (groups.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 48),
                      child: Column(children: [
                        Icon(Icons.fitness_center, size: 36, color: scheme.outline.withValues(alpha: 0.5)),
                        const SizedBox(height: 12),
                        Text('No workout history yet. Start tracking!', style: theme.textTheme.bodyMedium?.copyWith(color: scheme.outline)),
                      ]),
                    )
                  else
                    for (final group in groups) ...[
                      _WeekHeading(label: weekLabel(group.weekStart, clock), sets: calcWeeklyVolume(group.days)),
                      for (final day in group.days)
                        _DayRow(
                          key: ValueKey('history-${day.date}'),
                          day: day,
                          sessionLabel: labels[day.sessionType] ?? getSessionLabel(day.sessionType),
                          onOpen: () {
                            services.tracker.setCurrentDate(day.date);
                            Navigator.of(context).pop();
                          },
                          onRemove: () => _remove(context, day.date),
                        ),
                      const SizedBox(height: 16),
                    ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.icon, required this.value, required this.label});

  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
        child: Column(children: [
          Icon(icon, color: theme.colorScheme.primary, size: 20),
          const SizedBox(height: 4),
          Text(value, style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
          Text(label.toUpperCase(), textAlign: TextAlign.center, style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 0.8, color: theme.colorScheme.outline)),
        ]),
      ),
    );
  }
}

class _WeekHeading extends StatelessWidget {
  const _WeekHeading({required this.label, required this.sets});

  final String label;
  final int sets;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.labelMedium?.copyWith(letterSpacing: 1.2, color: Theme.of(context).colorScheme.outline);
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
      child: Text.rich(TextSpan(children: [
        TextSpan(text: label.toUpperCase(), style: style?.copyWith(fontWeight: FontWeight.w700)),
        if (sets > 0) TextSpan(text: ' · $sets sets', style: style?.copyWith(letterSpacing: 0)),
      ])),
    );
  }
}

class _DayRow extends StatelessWidget {
  const _DayRow({super.key, required this.day, required this.sessionLabel, required this.onOpen, required this.onRemove});

  final DayData day;
  final String sessionLabel;
  final VoidCallback onOpen;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final pct = dayProgress(day);
    final barColor = switch (progressTone(pct)) {
      ProgressTone.complete => scheme.tertiary,
      ProgressTone.good => scheme.primary,
      ProgressTone.low => Colors.amber.shade700,
    };
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Dismissible(
        key: ValueKey('dismiss-${day.date}'),
        direction: DismissDirection.endToStart,
        // Asking first; the day is removed only if confirmed, so the row springs back either way.
        confirmDismiss: (_) async {
          onRemove();
          return false;
        },
        background: Container(
          alignment: Alignment.centerRight,
          padding: const EdgeInsets.only(right: 20),
          decoration: BoxDecoration(color: scheme.errorContainer, borderRadius: BorderRadius.circular(14)),
          child: Icon(Icons.delete_outline, color: scheme.onErrorContainer),
        ),
        child: Semantics(
          customSemanticsActions: {const CustomSemanticsAction(label: 'Remove day'): onRemove},
          child: Material(
            color: scheme.surfaceContainerLow,
            borderRadius: BorderRadius.circular(14),
            child: InkWell(
              borderRadius: BorderRadius.circular(14),
              onTap: onOpen,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                        Text(rowDateLabel(day.date), style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                        Flexible(child: Text(sessionLabel, style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant), overflow: TextOverflow.ellipsis)),
                      ]),
                      if (pct > 0) ...[
                        const SizedBox(height: 6),
                        Row(children: [
                          Expanded(
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(4),
                              child: LinearProgressIndicator(value: pct / 100, minHeight: 6, color: barColor, backgroundColor: scheme.surfaceContainerHighest),
                            ),
                          ),
                          SizedBox(width: 36, child: Text('$pct%', textAlign: TextAlign.right, style: theme.textTheme.labelSmall?.copyWith(color: scheme.outline))),
                        ]),
                      ],
                    ]),
                  ),
                  if (day.weight.trim().isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(left: 12),
                      child: Text('${day.weight} kg', style: theme.textTheme.bodySmall?.copyWith(color: scheme.outline)),
                    ),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
