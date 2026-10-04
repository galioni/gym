import 'package:flutter/material.dart';

import '../../domain/session_types.dart';

/// Chooses the session for the day. Sessions the user made are listed first, AI-generated ones under their own heading
/// (as the web app groups them); the session already on the day is always selectable, even if the active plan leaves it out.
class SessionPicker extends StatelessWidget {
  const SessionPicker({super.key, required this.options, required this.selected, required this.onChanged});

  final List<SessionOption> options;
  final String selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final all = [
      ...options,
      if (!options.any((o) => o.value == selected)) SessionOption(value: selected, label: getSessionLabel(selected)),
    ];
    final mine = [for (final o in all) if (o.source != 'ai') o];
    final ai = [for (final o in all) if (o.source == 'ai') o];

    DropdownMenuItem<String> item(SessionOption o, {bool tagAi = false}) => DropdownMenuItem(
          value: o.value,
          child: Text(tagAi ? '${o.label} [AI]' : o.label, overflow: TextOverflow.ellipsis),
        );
    DropdownMenuItem<String> heading(String text) => DropdownMenuItem(
          enabled: false,
          value: '__heading_$text',
          child: Text(text.toUpperCase(), style: Theme.of(context).textTheme.labelSmall?.copyWith(letterSpacing: 1.2)),
        );

    final items = ai.isEmpty
        ? [for (final o in all) item(o)]
        : [
            if (mine.isNotEmpty) ...[heading('My sessions'), for (final o in mine) item(o)],
            heading('AI generated'),
            for (final o in ai) item(o, tagAi: true),
          ];

    return DropdownButtonFormField<String>(
      key: ValueKey('session-$selected-${all.length}'),
      initialValue: selected,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: 'Session',
        prefixIcon: const Icon(Icons.fitness_center, size: 18),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(16)),
      ),
      items: items,
      onChanged: (v) {
        if (v != null && v != selected && !v.startsWith('__heading_')) onChanged(v);
      },
    );
  }
}
