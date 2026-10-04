/// The words the sync screen uses for a conflict: what differs ("3 Oct — main notes") and how long ago each side
/// changed. Port of the helpers in the web app's `SyncSettingsPanel.tsx`; the expected strings in the tests were
/// produced by running that code.
library;

import 'sync_types.dart';

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
final _dateKey = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');

const _simpleFields = {
  'weight': 'body weight',
  'warmupNotes': 'warm-up notes',
  'mainNotes': 'main notes',
  'checkNotes': 'check-in notes',
  'sessionType': 'session type',
};

String _capitalise(String w) => w.isEmpty ? w : w.substring(0, 1).toUpperCase() + w.substring(1);

/// A path from the conflict preview ("2026-10-01.main.0.done") as a phrase a person can read.
String formatConflictPath(SyncEntity entity, String path) {
  final parts = path.split('.');
  String? at(int i) => i < parts.length ? parts[i] : null;

  switch (entity) {
    case SyncEntity.workoutData:
      final dateKey = at(0);
      if (dateKey == null || dateKey.isEmpty) return path;
      final m = _dateKey.firstMatch(dateKey);
      final dateStr = m == null ? dateKey : '${int.parse(m.group(3)!)} ${_months[int.parse(m.group(2)!) - 1]}';
      final field = at(1);
      final idx = at(2);
      final sub = at(3);
      if (field == null) return dateStr;
      if (_simpleFields.containsKey(field)) return '$dateStr — ${_simpleFields[field]}';
      if (field == 'warmup' || field == 'main') {
        final section = field == 'warmup' ? 'warm-up' : 'main';
        final n = idx != null ? ' #${int.parse(idx) + 1}' : '';
        return switch (sub) {
          'done' => '$dateStr — $section$n (checked)',
          'text' => '$dateStr — $section$n name',
          'target' => '$dateStr — $section$n target',
          _ => '$dateStr — $section$n',
        };
      }
      return '$dateStr — $field';
    case SyncEntity.templates:
      final sessionKey = at(0);
      if (sessionKey == null || sessionKey.isEmpty) return path;
      final session = sessionKey.split(RegExp(r'[-_]')).map(_capitalise).join(' ');
      final section = at(1);
      if (section == null) return session;
      final sec = section == 'warmup' ? 'warm-up' : section;
      final n = at(2) != null ? ' #${int.parse(at(2)!) + 1}' : '';
      return switch (at(3)) {
        'text' => '$session — $sec$n name',
        'target' => '$session — $sec$n target',
        _ => '$session — $sec$n',
      };
    case SyncEntity.plans:
      return 'Plan "$path"';
    case SyncEntity.settings:
      return path == 'activePlanId' ? 'Active plan' : 'Plan details';
  }
}

/// "just now", "5m ago", "3h ago", "2d ago".
String relativeTime(String iso, DateTime now) {
  final minutes = (now.millisecondsSinceEpoch - DateTime.parse(iso).millisecondsSinceEpoch) ~/ 60000;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return '${minutes}m ago';
  final hours = minutes ~/ 60;
  if (hours < 24) return '${hours}h ago';
  return '${hours ~/ 24}d ago';
}

/// The heading of a conflict card.
String entityLabel(SyncEntity entity) => switch (entity) {
      SyncEntity.workoutData => 'Workout data',
      SyncEntity.templates => 'Templates',
      _ => 'Plans',
    };
