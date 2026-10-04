import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'notes_field.dart';

/// Why a weight is not accepted, or null when it is fine to store (same rules and wording as the web app).
String? weightProblem(String raw) {
  if (raw.isEmpty) return null;
  final numeric = double.tryParse(raw.replaceAll(',', '.'));
  if (numeric == null || numeric < 0) return 'Must be a positive number';
  if (numeric > 500) return 'Value seems too high (max 500 kg)';
  return null;
}

/// Weight and a line of readiness notes for the day.
class DailyCheckCard extends StatefulWidget {
  const DailyCheckCard({super.key, required this.weight, required this.checkNotes, required this.onWeight, required this.onCheckNotes});

  final String weight;
  final String checkNotes;

  /// Called only with a weight that passed [weightProblem].
  final ValueChanged<String> onWeight;
  final ValueChanged<String> onCheckNotes;

  @override
  State<DailyCheckCard> createState() => _DailyCheckCardState();
}

class _DailyCheckCardState extends State<DailyCheckCard> {
  String? _error;

  void _weightChanged(String raw) {
    final problem = weightProblem(raw);
    setState(() => _error = problem);
    if (problem == null) widget.onWeight(raw);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              const Icon(Icons.monitor_weight_outlined, size: 18),
              const SizedBox(width: 8),
              Text('Quick Check', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            ]),
            const SizedBox(height: 14),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 130,
                  child: NotesField(
                    value: widget.weight,
                    label: 'Weight (kg)',
                    hint: 'e.g. 79.5',
                    minLines: 1,
                    maxLines: 1,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    errorText: _error,
                    inputFormatters: weightInputFormatters,
                    onChanged: _weightChanged,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: NotesField(
                    value: widget.checkNotes,
                    label: 'Check-in notes',
                    hint: 'Sleep, stress, soreness...',
                    minLines: 1,
                    maxLines: 3,
                    onChanged: widget.onCheckNotes,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Keeps a weight field to digits and one decimal separator.
final weightInputFormatters = <TextInputFormatter>[FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))];
