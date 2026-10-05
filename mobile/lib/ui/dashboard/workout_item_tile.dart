import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../domain/models.dart';

/// One exercise in a checklist: tap to tick it, swipe left (or use the screen reader action) to remove it.
class WorkoutItemTile extends StatefulWidget {
  const WorkoutItemTile({super.key, required this.item, required this.onToggle, required this.onDelete, this.openUrl});

  final WorkoutItem item;
  final void Function(bool done) onToggle;

  /// Asks the user to confirm and removes the item; true when it was removed.
  final Future<bool> Function() onDelete;

  /// Opens a link; the platform's browser unless a test replaces it.
  final Future<void> Function(Uri url)? openUrl;

  @override
  State<WorkoutItemTile> createState() => _WorkoutItemTileState();
}

class _WorkoutItemTileState extends State<WorkoutItemTile> {
  bool _showDescription = false;

  Future<void> _open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    final open = widget.openUrl ?? (Uri u) async => launchUrl(u, mode: LaunchMode.externalApplication);
    await open(uri);
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final muted = scheme.onSurfaceVariant;

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Semantics(
        customSemanticsActions: {const CustomSemanticsAction(label: 'Remove exercise'): () => widget.onDelete()},
        child: Dismissible(
          key: ValueKey('dismiss-${item.id}'),
          direction: DismissDirection.endToStart,
          // The item is removed by the confirmation itself (as on the web); the swipe only asks, so it springs back.
          confirmDismiss: (_) async {
            HapticFeedback.selectionClick();
            await widget.onDelete();
            return false;
          },
          background: Container(
            alignment: Alignment.centerRight,
            padding: const EdgeInsets.only(right: 20),
            decoration: BoxDecoration(color: scheme.errorContainer, borderRadius: BorderRadius.circular(16)),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(Icons.delete_outline, color: scheme.onErrorContainer),
              const SizedBox(width: 6),
              Text('Delete', style: TextStyle(color: scheme.onErrorContainer, fontWeight: FontWeight.w700)),
            ]),
          ),
          child: Material(
            color: item.done ? scheme.surfaceContainerLow : scheme.surfaceContainerHigh,
            borderRadius: BorderRadius.circular(16),
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: () {
                HapticFeedback.lightImpact();
                widget.onToggle(!item.done);
              },
              child: Opacity(
                opacity: item.done ? 0.6 : 1,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: _CheckCircle(done: item.done),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              item.text,
                              style: theme.textTheme.bodyLarge?.copyWith(
                                fontWeight: FontWeight.w500,
                                decoration: item.done ? TextDecoration.lineThrough : null,
                                color: item.done ? muted : null,
                              ),
                            ),
                            if (item.target != null && item.target!.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(top: 6),
                                child: Text(item.target!, style: theme.textTheme.bodySmall?.copyWith(color: scheme.tertiary, fontWeight: FontWeight.w600)),
                              ),
                            if (item.equipment != null && item.equipment!.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Row(mainAxisSize: MainAxisSize.min, children: [
                                  Icon(Icons.fitness_center, size: 12, color: muted),
                                  const SizedBox(width: 4),
                                  Flexible(child: Text(item.equipment!, style: theme.textTheme.bodySmall?.copyWith(color: muted))),
                                ]),
                              ),
                            if (item.description != null && item.description!.isNotEmpty) ...[
                              InkWell(
                                onTap: () => setState(() => _showDescription = !_showDescription),
                                child: Padding(
                                  padding: const EdgeInsets.only(top: 6),
                                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                                    Text('How to', style: theme.textTheme.labelSmall?.copyWith(color: muted)),
                                    Icon(_showDescription ? Icons.expand_less : Icons.expand_more, size: 14, color: muted),
                                  ]),
                                ),
                              ),
                              if (_showDescription)
                                Padding(
                                  padding: const EdgeInsets.only(top: 4),
                                  child: Text(item.description!, style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
                                ),
                            ],
                            if (item.videoUrl != null && item.videoUrl!.isNotEmpty)
                              InkWell(
                                onTap: () => _open(item.videoUrl!),
                                child: Padding(
                                  padding: const EdgeInsets.only(top: 6),
                                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                                    Icon(Icons.smart_display_outlined, size: 14, color: scheme.error),
                                    const SizedBox(width: 4),
                                    Text('Watch video', style: theme.textTheme.bodySmall?.copyWith(color: scheme.error)),
                                  ]),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CheckCircle extends StatelessWidget {
  const _CheckCircle({required this.done});

  final bool done;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      width: 24,
      height: 24,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: done ? scheme.primary : Colors.transparent,
        border: Border.all(color: done ? scheme.primary : scheme.outline, width: 2),
      ),
      child: done ? Icon(Icons.check, size: 14, color: scheme.onPrimary) : null,
    );
  }
}
