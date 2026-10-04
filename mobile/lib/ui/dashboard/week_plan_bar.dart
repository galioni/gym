import 'package:flutter/material.dart';

import '../../domain/week_plan.dart';

/// The active plan's week as a row of pills: done, today's, next up, overdue (see [buildWeekPlan]).
class WeekPlanBar extends StatelessWidget {
  const WeekPlanBar({super.key, required this.view, required this.labelFor, this.onSelectSession});

  final WeekPlanView view;
  final String Function(String sessionType) labelFor;

  /// Tapping a pill that is not done starts that session on the day.
  final ValueChanged<String>? onSelectSession;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(view.label.toUpperCase(), style: Theme.of(context).textTheme.labelSmall?.copyWith(letterSpacing: 1.2, fontWeight: FontWeight.w700, color: scheme.onSurfaceVariant)),
        if (view.allDone)
          Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.check, size: 14, color: scheme.primary),
            const SizedBox(width: 4),
            Text('Week complete', style: TextStyle(color: scheme.primary, fontWeight: FontWeight.w600, fontSize: 12)),
          ])
        else
          for (final pill in view.pills) _Pill(pill: pill, label: labelFor(pill.sessionType), onSelect: onSelectSession),
      ],
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.pill, required this.label, required this.onSelect});

  final WeekPill pill;
  final String label;
  final ValueChanged<String>? onSelect;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final interactive = !pill.done && onSelect != null;

    final (Color background, Color border, Color text) = pill.done
        ? (scheme.surfaceContainerLow, Colors.transparent, scheme.onSurfaceVariant)
        : pill.isCurrent
            ? (scheme.primaryContainer, scheme.primary, scheme.onPrimaryContainer)
            : pill.isNext
                ? (scheme.primaryContainer.withValues(alpha: 0.5), scheme.primary.withValues(alpha: 0.5), scheme.primary)
                : pill.isOverdue
                    ? (scheme.tertiaryContainer.withValues(alpha: 0.5), scheme.tertiary, scheme.onTertiaryContainer)
                    : (Colors.transparent, scheme.outlineVariant, scheme.onSurfaceVariant);

    final status = pill.done
        ? 'completed'
        : pill.isCurrent
            ? 'today'
            : pill.isNext
                ? 'next'
                : pill.isOverdue
                    ? 'overdue'
                    : null;

    return Semantics(
      button: interactive,
      label: [if (pill.dayLabel != null) pill.dayLabel!, label, if (status != null) '($status)'].join(' '),
      child: ExcludeSemantics(
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: interactive ? () => onSelect!(pill.sessionType) : null,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: background,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: border),
            ),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              if (pill.done) Padding(padding: const EdgeInsets.only(right: 4), child: Icon(Icons.check, size: 12, color: text)),
              if (!pill.done && pill.isCurrent) Padding(padding: const EdgeInsets.only(right: 4), child: Icon(Icons.circle, size: 7, color: scheme.primary)),
              if (!pill.done && !pill.isCurrent && pill.isNext) Padding(padding: const EdgeInsets.only(right: 2), child: Icon(Icons.chevron_right, size: 12, color: text)),
              if (pill.dayLabel != null) Padding(padding: const EdgeInsets.only(right: 4), child: Text(pill.dayLabel!, style: TextStyle(fontSize: 10, color: text.withValues(alpha: 0.7)))),
              Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: text)),
            ]),
          ),
        ),
      ),
    );
  }
}
