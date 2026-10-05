import 'package:flutter/material.dart';

import '../../domain/history_stats.dart';
import '../../domain/models.dart';

/// Body weight over time: the latest value, how far it moved, and a line with a soft fill (the web app's chart).
class WeightChart extends StatelessWidget {
  const WeightChart({super.key, required this.allData});

  final Map<String, DayData> allData;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final entries = weightSeries(allData);

    if (entries.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Center(
          child: Text('No weight logged yet — add your weight in the daily tracker.', style: theme.textTheme.bodySmall?.copyWith(color: scheme.outline)),
        ),
      );
    }
    final latest = entries.last;
    final first = entries.first;
    if (entries.length == 1) {
      return Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
        Text('${formatKg(latest.weight)} kg', style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(width: 12),
        Text(chartDateLabel(latest.date), style: theme.textTheme.bodySmall?.copyWith(color: scheme.outline)),
      ]);
    }

    return Semantics(
      label: 'Body weight, ${entries.length} entries: ${formatKg(first.weight)} kg on ${chartDateLabel(first.date)} to '
          '${formatKg(latest.weight)} kg on ${chartDateLabel(latest.date)}, ${weightDeltaLabel(entries)}',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.end,
            spacing: 12,
            runSpacing: 4,
            children: [
              Wrap(crossAxisAlignment: WrapCrossAlignment.end, spacing: 10, children: [
                Text('${formatKg(latest.weight)} kg', style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
                Text(weightDeltaLabel(entries), style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
              ]),
              Text('${entries.length} entries', style: theme.textTheme.labelSmall?.copyWith(color: scheme.outline)),
            ],
          ),
          const SizedBox(height: 6),
          ExcludeSemantics(
            child: SizedBox(
              height: 72,
              width: double.infinity,
              child: CustomPaint(painter: _WeightPainter(entries: entries, color: scheme.primary)),
            ),
          ),
          const SizedBox(height: 4),
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Text(chartDateLabel(first.date), style: theme.textTheme.labelSmall?.copyWith(color: scheme.outline)),
            Text(chartDateLabel(latest.date), style: theme.textTheme.labelSmall?.copyWith(color: scheme.outline)),
          ]),
        ],
      ),
    );
  }
}

class _WeightPainter extends CustomPainter {
  _WeightPainter({required this.entries, required this.color});

  final List<WeightEntry> entries;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    const padTop = 6.0, padBottom = 6.0;
    final plotH = size.height - padTop - padBottom;
    final weights = [for (final e in entries) e.weight];
    final minW = weights.reduce((a, b) => a < b ? a : b);
    final maxW = weights.reduce((a, b) => a > b ? a : b);
    final range = (maxW - minW) == 0 ? 1.0 : maxW - minW;
    double x(int i) => i / (entries.length - 1) * size.width;
    double y(double w) => padTop + plotH - (w - minW) / range * plotH;

    final line = Path()..moveTo(x(0), y(entries[0].weight));
    for (var i = 1; i < entries.length; i++) {
      line.lineTo(x(i), y(entries[i].weight));
    }
    final area = Path.from(line)
      ..lineTo(size.width, padTop + plotH)
      ..lineTo(0, padTop + plotH)
      ..close();

    canvas.drawPath(
      area,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [color.withValues(alpha: 0.18), color.withValues(alpha: 0.01)],
        ).createShader(Offset.zero & size),
    );
    canvas.drawPath(
      line,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.5
        ..strokeJoin = StrokeJoin.round
        ..strokeCap = StrokeCap.round,
    );
    // One dot per entry when there are few enough to read; otherwise just the ends.
    final dot = Paint()..color = color;
    if (entries.length <= 20) {
      for (var i = 0; i < entries.length; i++) {
        canvas.drawCircle(Offset(x(i), y(entries[i].weight)), 3.5, dot);
      }
    } else {
      canvas.drawCircle(Offset(x(0), y(entries.first.weight)), 3.5, dot);
      canvas.drawCircle(Offset(size.width, y(entries.last.weight)), 3.5, dot);
    }
  }

  @override
  bool shouldRepaint(_WeightPainter old) => old.entries != entries || old.color != color;
}
