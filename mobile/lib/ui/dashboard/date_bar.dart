import 'package:flutter/material.dart';

import '../../domain/dates.dart';

const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// "Sat 3 Oct 2026".
String describeDay(String dateKey) {
  final d = fromLocalDateKey(dateKey);
  return '${_weekdays[d.weekday - 1]} ${d.day} ${_months[d.month - 1]} ${d.year}';
}

/// Which day is shown: previous, next, a date picker, and a way back to today.
class DateBar extends StatelessWidget {
  const DateBar({super.key, required this.dateKey, required this.todayKey, required this.onSelect});

  final String dateKey;
  final String todayKey;
  final ValueChanged<String> onSelect;

  Future<void> _pick(BuildContext context) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: fromLocalDateKey(dateKey),
      // The range the database can hold.
      firstDate: DateTime(2000),
      lastDate: DateTime(2100, 12, 31),
    );
    if (picked != null) onSelect(toLocalDateKey(picked));
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isToday = dateKey == todayKey;
    return Row(
      children: [
        IconButton(
          tooltip: 'Previous day',
          icon: const Icon(Icons.chevron_left),
          onPressed: () => onSelect(shiftDateKey(dateKey, -1)),
        ),
        Expanded(
          child: OutlinedButton.icon(
            onPressed: () => _pick(context),
            icon: const Icon(Icons.calendar_today, size: 16),
            label: Text(describeDay(dateKey), overflow: TextOverflow.ellipsis),
            style: OutlinedButton.styleFrom(
              side: BorderSide(color: isToday ? scheme.primary : scheme.outlineVariant),
              minimumSize: const Size.fromHeight(44),
            ),
          ),
        ),
        IconButton(
          tooltip: 'Next day',
          icon: const Icon(Icons.chevron_right),
          onPressed: () => onSelect(shiftDateKey(dateKey, 1)),
        ),
        if (isToday)
          Container(
            margin: const EdgeInsets.only(left: 4),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: scheme.primaryContainer,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text('Today', style: TextStyle(color: scheme.onPrimaryContainer, fontWeight: FontWeight.w700, fontSize: 11)),
          )
        else
          TextButton.icon(
            onPressed: () => onSelect(todayKey),
            icon: const Icon(Icons.my_location, size: 16),
            label: const Text('Today'),
          ),
      ],
    );
  }
}
