import 'package:flutter/material.dart';

import '../../domain/models.dart';
import '../../state/section_timer.dart';
import 'notes_field.dart';
import 'timer_chip.dart';
import 'workout_item_tile.dart';

/// A checklist (warm-up or main session) with its timer and notes.
class WorkoutSectionCard extends StatelessWidget {
  const WorkoutSectionCard({
    super.key,
    required this.title,
    required this.items,
    required this.timer,
    required this.notes,
    required this.onToggleItem,
    required this.onDeleteItem,
    required this.onNotesChanged,
    this.openUrl,
  });

  final String title;
  final List<WorkoutItem> items;
  final SectionTimer timer;
  final String notes;
  final void Function(String id, bool done) onToggleItem;
  final Future<bool> Function(String id) onDeleteItem;
  final ValueChanged<String> onNotesChanged;
  final Future<void> Function(Uri url)? openUrl;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final done = items.where((i) => i.done).length;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              runSpacing: 8,
              spacing: 8,
              children: [
                Row(mainAxisSize: MainAxisSize.min, children: [
                  Text(title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                  if (items.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Text('$done/${items.length}', style: theme.textTheme.labelMedium?.copyWith(color: scheme.onSurfaceVariant)),
                  ],
                ]),
                TimerChip(timer: timer, label: title),
              ],
            ),
            const SizedBox(height: 14),
            if (items.isEmpty)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 16),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: scheme.outlineVariant),
                ),
                child: Column(children: [
                  Text('No exercises yet', style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600, color: scheme.onSurfaceVariant)),
                  const SizedBox(height: 4),
                  Text(
                    'Pick a session above to load its template, or build one in Settings.',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ]),
              )
            else
              for (final item in items)
                WorkoutItemTile(
                  key: ValueKey(item.id),
                  item: item,
                  openUrl: openUrl,
                  onToggle: (d) => onToggleItem(item.id, d),
                  onDelete: () => onDeleteItem(item.id),
                ),
            const SizedBox(height: 10),
            Text('SESSION NOTES', style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 1.4, fontWeight: FontWeight.w700, color: scheme.onSurfaceVariant)),
            const SizedBox(height: 8),
            NotesField(value: notes, hint: 'Log weights, feelings, or adjustments...', onChanged: onNotesChanged),
          ],
        ),
      ),
    );
  }
}
