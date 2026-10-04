import 'package:flutter/material.dart';

import '../../domain/workout_transitions.dart';

/// The strip along the bottom: how much of the day is done, whether a save is running, a shortcut back to the timer that
/// is running, and clearing the day.
class ProgressFooter extends StatelessWidget {
  const ProgressFooter({
    super.key,
    required this.percent,
    required this.isSaving,
    required this.onClear,
    this.runningSection,
    this.onGoToTimer,
    this.saveError,
  });

  final int percent;
  final bool isSaving;
  final VoidCallback onClear;
  final WorkoutSection? runningSection;
  final VoidCallback? onGoToTimer;

  /// Shown instead of "Saving" when the last save failed (it is retried by itself).
  final String? saveError;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final complete = percent == 100;
    return Material(
      elevation: 8,
      color: scheme.surfaceContainer,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 8, 10),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('DAILY PROGRESS', style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 1.2, fontWeight: FontWeight.w700, color: scheme.onSurfaceVariant)),
                        Row(mainAxisSize: MainAxisSize.min, children: [
                          if (runningSection != null)
                            InkWell(
                              onTap: onGoToTimer,
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 4),
                                child: Row(mainAxisSize: MainAxisSize.min, children: [
                                  Icon(Icons.timer, size: 14, color: scheme.primary),
                                  const SizedBox(width: 2),
                                  Text(runningSection == WorkoutSection.warmup ? 'Warm-up' : 'Main', style: TextStyle(color: scheme.primary, fontWeight: FontWeight.w700, fontSize: 12)),
                                ]),
                              ),
                            ),
                          const SizedBox(width: 4),
                          Text('$percent%', style: TextStyle(fontWeight: FontWeight.w700, color: complete ? scheme.tertiary : null)),
                        ]),
                      ],
                    ),
                    const SizedBox(height: 6),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(6),
                      child: LinearProgressIndicator(
                        value: percent / 100,
                        minHeight: 8,
                        color: complete ? scheme.tertiary : scheme.primary,
                        backgroundColor: scheme.surfaceContainerHighest,
                      ),
                    ),
                    if (saveError != null)
                      Padding(padding: const EdgeInsets.only(top: 4), child: Text(saveError!, style: TextStyle(color: scheme.error, fontSize: 11)))
                    else
                      AnimatedOpacity(
                        opacity: isSaving ? 1 : 0,
                        duration: const Duration(milliseconds: 250),
                        child: Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text('Saving…', style: theme.textTheme.labelSmall?.copyWith(color: scheme.onSurfaceVariant)),
                        ),
                      ),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Clear day',
                icon: Icon(Icons.delete_outline, color: scheme.error),
                onPressed: onClear,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
