import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../domain/dates.dart';
import '../../state/section_timer.dart';

/// The stopwatch of a section: time, start/pause, reset. It redraws itself as the timer ticks, so nothing else has to.
class TimerChip extends StatelessWidget {
  const TimerChip({super.key, required this.timer, required this.label});

  final SectionTimer timer;

  /// What the timer times ("Warm-up"), for screen readers.
  final String label;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListenableBuilder(
      listenable: timer,
      builder: (context, _) {
        final running = timer.isRunning;
        final time = formatTimer(timer.elapsedMs);
        return Semantics(
          container: true,
          label: '$label timer: ${running ? 'running' : 'paused'}, $time',
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerLow,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: scheme.outlineVariant),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                SizedBox(
                  width: 64,
                  child: ExcludeSemantics(
                    child: Text(
                      time,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontFeatures: const [FontFeature.tabularFigures()],
                        fontWeight: FontWeight.w700,
                        fontSize: 17,
                        color: scheme.primary,
                      ),
                    ),
                  ),
                ),
                IconButton.filledTonal(
                  tooltip: running ? 'Pause timer' : 'Start timer',
                  visualDensity: VisualDensity.compact,
                  icon: Icon(running ? Icons.pause : Icons.play_arrow, size: 18),
                  onPressed: () {
                    HapticFeedback.selectionClick();
                    timer.toggle();
                  },
                ),
                IconButton(
                  tooltip: 'Reset timer',
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.restart_alt, size: 18),
                  onPressed: timer.reset,
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
