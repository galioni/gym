/// Pure mapping between app types and database rows (`infrastructure/supabase/postgresRows.ts`; schema in
/// supabase/migrations). Writes clamp values to the database CHECK limits so one oversized field can never
/// make an upsert fail and wedge sync; reads return "raw" shapes that callers pass through the same sanitisers
/// the local repositories use, so a day read back from the database is structurally identical to the day that
/// was written.
///
/// Rows are JSON maps exactly as PostgREST returns and accepts them.
library;

import '../domain/models.dart';
import '../domain/templates.dart';

const _msPerDay = 86400000;
const _maxItems = 200;

String _clampText(Object? v, int max) => v is String ? (v.length > max ? v.substring(0, max) : v) : '';
int _clampTimer(int v) => v < 0 ? 0 : (v > _msPerDay ? _msPerDay : v);
List<Object?> _clampItems(List<Json> items) => items.length > _maxItems ? items.sublist(0, _maxItems) : items;

final _dayKey = RegExp(r'^\d{4}-\d{2}-\d{2}$');

/// Whether the database can hold [date] as a `date` in its 2000..2100 range.
///
/// Stricter than the web app, which accepts anything `Date.parse` does (so `2026-02-31` passes there and then
/// fails in Postgres, which would wedge sync on corrupt local data). Here the day must be a real calendar day.
bool isStorableDayKey(String date) {
  if (!_dayKey.hasMatch(date)) return false;
  final y = int.parse(date.substring(0, 4));
  final m = int.parse(date.substring(5, 7));
  final d = int.parse(date.substring(8, 10));
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= DateTime.utc(y, m + 1, 0).day;
}

/// Null for a key the database cannot hold (corrupt local data must not block sync).
Json? dayToRow(String userId, String date, DayData day) {
  if (!isStorableDayKey(date)) return null;
  final sessionType = _clampText(day.sessionType, 100);
  return {
    'user_id': userId,
    'day': date,
    'session_type': sessionType.isNotEmpty ? sessionType : 'unknown',
    'warmup': _clampItems([for (final i in day.warmup) i.toJson()]),
    'main': _clampItems([for (final i in day.main) i.toJson()]),
    'warmup_notes': _clampText(day.warmupNotes, 20000),
    'main_notes': _clampText(day.mainNotes, 20000),
    'warmup_timer_ms': _clampTimer(day.warmupTimerMs),
    'main_timer_ms': _clampTimer(day.mainTimerMs),
    'weight': _clampText(day.weight, 32),
    'check_notes': _clampText(day.checkNotes, 20000),
    'deleted_at': null,
    'deleted_hash': null,
  };
}

/// The day as raw JSON, for the sanitiser.
Json rowToRawDay(Json row) => {
      'date': row['day'],
      'sessionType': row['session_type'],
      'warmup': row['warmup'],
      'main': row['main'],
      'warmupNotes': row['warmup_notes'],
      'mainNotes': row['main_notes'],
      'warmupTimerMs': row['warmup_timer_ms'],
      'mainTimerMs': row['main_timer_ms'],
      'weight': row['weight'],
      'checkNotes': row['check_notes'],
    };

String? _capped(String? v, int max) => v == null ? null : (v.length > max ? v.substring(0, max) : v);

List<Json> templatesToRows(String userId, Templates templates) {
  final entries = [for (final e in templates.entries) if (e.key.isNotEmpty && e.key.length <= 100) e];
  return [
    for (var index = 0; index < entries.length; index++)
      {
        'user_id': userId,
        'session_type': entries[index].key,
        'label': _capped(entries[index].value.label, 200),
        'focus': _capped(entries[index].value.focus, 500),
        'source': entries[index].value.source == 'ai' || entries[index].value.source == 'user' ? entries[index].value.source : null,
        'video_url': _capped(entries[index].value.videoUrl, 2000),
        'warmup': _clampItems([for (final r in entries[index].value.warmup) r.toJson()]),
        'main': _clampItems([for (final r in entries[index].value.main) r.toJson()]),
        'position': index < 10000 ? index : 10000,
        'deleted_at': null,
      },
  ];
}

int _position(Json row) => (row['position'] as num?)?.toInt() ?? 0;

/// Rows come back in position order; optional fields are omitted when null so the shape matches local data.
Json rowsToRawTemplates(List<Json> rows) {
  final sorted = [...rows]..sort((a, b) {
      final byPosition = _position(a).compareTo(_position(b));
      return byPosition != 0 ? byPosition : (a['session_type'] as String).compareTo(b['session_type'] as String);
    });
  return {
    for (final row in sorted)
      row['session_type'] as String: {
        'warmup': row['warmup'],
        'main': row['main'],
        if (row['label'] != null) 'label': row['label'],
        if (row['focus'] != null) 'focus': row['focus'],
        if (row['source'] != null) 'source': row['source'],
        if (row['video_url'] != null) 'videoUrl': row['video_url'],
      },
  };
}

List<Json> plansToRows(String userId, List<Plan> plans) {
  final kept = [for (final p in plans) if (p.id.isNotEmpty && p.id.length <= 100) p];
  return [
    for (var index = 0; index < kept.length; index++)
      {
        'user_id': userId,
        'id': kept[index].id,
        'label': kept[index].label.trim().isNotEmpty ? _capped(kept[index].label, 200) : 'Plan',
        'session_ids': kept[index].sessionIds.length > _maxItems ? kept[index].sessionIds.sublist(0, _maxItems) : kept[index].sessionIds,
        'schedule': kept[index].schedule,
        'position': index < 10000 ? index : 10000,
        'deleted_at': null,
      },
  ];
}

List<Plan> rowsToPlans(List<Json> rows) {
  final sorted = [...rows]..sort((a, b) {
      final byPosition = _position(a).compareTo(_position(b));
      return byPosition != 0 ? byPosition : (a['id'] as String).compareTo(b['id'] as String);
    });
  return [
    for (final row in sorted)
      Plan(
        id: row['id'] as String,
        label: row['label'] as String,
        sessionIds: (row['session_ids'] as List).cast<String>(),
        schedule: row['schedule'] is Map ? (row['schedule'] as Map).cast<String, String>() : null,
      ),
  ];
}

/// The newest server timestamp among [rows], or now when none carries one.
String latestUpdatedAt(List<Json> rows, [DateTime Function() now = DateTime.now]) {
  final stamps = [for (final r in rows) if (r['updated_at'] is String) r['updated_at'] as String];
  return stamps.isEmpty ? now().toUtc().toIso8601String() : stamps.reduce((a, b) => a.compareTo(b) > 0 ? a : b);
}
