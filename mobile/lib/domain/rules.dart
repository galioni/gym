/// Port of the web app's sanitisers and snapshot migrations (`dayDataRules.ts`, `templateRules.ts`,
/// `snapshotMigrations.ts`, `createEmptyDay`). Whatever is read from storage or the cloud passes through
/// these, so a stored day hashes the same on both clients. Behaviour is pinned by
/// contract/sanitize.fixtures.json.
///
/// Quirks carried over on purpose (changing them is a web + Dart + fixture change together):
///  * day items lose `equipment` and `description` when sanitised;
///  * a built-in session (tennis, gym, swim, rest) whose section is empty is refilled from the defaults;
///  * a template section that sanitises to empty falls back to the built-in default for that session.
///
/// One deliberate difference: where the web code would throw on a non-string `text`, this treats it as "".
library;

import 'dart:math';

import '../sync/sync_types.dart';
import 'defaults.dart';
import 'models.dart';
import 'templates.dart';

typedef IdGenerator = String Function();

final _random = Random();
const _base36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/// Same alphabet and length as the web app's `generateId()`.
String generateId() => String.fromCharCodes([for (var i = 0; i < 7; i++) _base36.codeUnitAt(_random.nextInt(36))]);

/// JS `Boolean(x)` for a JSON value.
bool _truthy(Object? v) => switch (v) {
      null => false,
      bool b => b,
      num n => n != 0 && !n.isNaN,
      String s => s.isNotEmpty,
      _ => true,
    };

String _truncate(String s, int max) => s.length > max ? s.substring(0, max) : s;

String? _nonBlank(Object? v) {
  if (v is! String) return null;
  final t = v.trim();
  return t.isEmpty ? null : t;
}

String getValidSessionType(Object? value) => _nonBlank(value) ?? defaultSessionType;

DayData createEmptyDay(
  String date,
  String sessionType, {
  Templates templates = defaultTemplates,
  IdGenerator idGen = generateId,
}) {
  final template = templates[sessionType] ?? emptyTemplate;
  WorkoutItem item(TemplateRow r) => WorkoutItem(
        id: idGen(),
        text: r.text,
        target: r.target,
        equipment: r.equipment,
        description: r.description,
        videoUrl: r.videoUrl,
      );
  return DayData(
    date: date,
    sessionType: sessionType,
    warmup: [for (final r in template.warmup) item(r)],
    main: [for (final r in template.main) item(r)],
  );
}

List<WorkoutItem> _normalizeItems(Object? items, List<WorkoutItem> fallback, String date) {
  if (items is! List) return fallback;
  // JS counts every object (arrays included) once nulls are gone; the index feeds the fallback id.
  final objects = [for (final e in items) if (e is Map || e is List) e];
  final normalized = <WorkoutItem>[];
  for (var index = 0; index < objects.length; index++) {
    final o = objects[index];
    final m = o is Map ? o.cast<String, Object?>() : const <String, Object?>{};
    final id = m['id'];
    final text = m['text'];
    final item = WorkoutItem(
      id: id is String && id.isNotEmpty ? id : '$date-$index',
      text: text is String ? text : '',
      target: m['target'] is String ? m['target'] as String : null,
      videoUrl: _nonBlank(m['videoUrl']),
      done: _truthy(m['done']),
      explicitKeys: true,
    );
    if (item.text.trim().isNotEmpty) normalized.add(item);
  }
  return normalized.isNotEmpty ? normalized : fallback;
}

/// Coerces an unknown day payload into a safe [DayData], recovering section by section.
DayData sanitizeDayData(
  Object? raw,
  String date, {
  Templates templates = defaultTemplates,
  IdGenerator idGen = generateId,
}) {
  final record = raw is Map ? raw.cast<String, Object?>() : const <String, Object?>{};
  final sessionType = getValidSessionType(record['sessionType']);
  final baseline = createEmptyDay(date, sessionType, templates: templates, idGen: idGen);

  String str(String key, String fallback) => record[key] is String ? record[key] as String : fallback;
  int timer(String key, int fallback) {
    final v = record[key];
    return v is num && v.isFinite ? max(0, v.round()) : fallback;
  }

  return DayData(
    date: date,
    sessionType: sessionType,
    warmup: _normalizeItems(record['warmup'], baseline.warmup, date),
    main: _normalizeItems(record['main'], baseline.main, date),
    warmupNotes: str('warmupNotes', baseline.warmupNotes),
    mainNotes: str('mainNotes', baseline.mainNotes),
    warmupTimerMs: timer('warmupTimerMs', baseline.warmupTimerMs),
    mainTimerMs: timer('mainTimerMs', baseline.mainTimerMs),
    weight: str('weight', baseline.weight),
    checkNotes: str('checkNotes', baseline.checkNotes),
  );
}

Map<String, DayData> sanitizeDayDataRecord(
  Object? raw, {
  Templates templates = defaultTemplates,
  IdGenerator idGen = generateId,
}) {
  if (raw is! Map) return {};
  return {
    for (final e in raw.entries)
      e.key as String: sanitizeDayData(e.value, e.key as String, templates: templates, idGen: idGen),
  };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

List<TemplateRow> _sanitizeRows(List<Object?> rows, IdGenerator idGen) {
  final out = <TemplateRow>[];
  for (final r in rows) {
    if (r is! Map) continue;
    final m = r.cast<String, Object?>();
    final text = _truncate(m['text'] is String ? (m['text'] as String).trim() : '', templateTextMaxLength);
    if (text.isEmpty) continue;
    final target = _truncate(m['target'] is String ? (m['target'] as String).trim() : '', templateTargetMaxLength);
    final equipment = _nonBlank(m['equipment']);
    final description = _nonBlank(m['description']);
    out.add(TemplateRow(
      id: m['id'] is String ? m['id'] as String : idGen(),
      text: text,
      target: target.isEmpty ? null : target,
      equipment: equipment == null ? null : _truncate(equipment, 50),
      description: description == null ? null : _truncate(description, 200),
      videoUrl: _nonBlank(m['videoUrl']),
      explicitKeys: true,
    ));
  }
  return out;
}

TemplateData _sanitizeSessionTemplate(Object? input, TemplateData fallback, IdGenerator idGen) {
  final safe = input is Map ? input.cast<String, Object?>() : null;
  final warmup = safe?['warmup'] is List ? _sanitizeRows(safe!['warmup'] as List<Object?>, idGen) : fallback.warmup;
  final main = safe?['main'] is List ? _sanitizeRows(safe!['main'] as List<Object?>, idGen) : fallback.main;
  final rawSource = safe?['source'];
  final label = _nonBlank(safe?['label']);
  final videoUrl = _nonBlank(safe?['videoUrl']);
  return TemplateData(
    source: rawSource == 'ai' || rawSource == 'user' ? rawSource as String : null,
    label: label == null ? null : _truncate(label, 50),
    focus: _nonBlank(safe?['focus']),
    videoUrl: videoUrl == null ? null : _truncate(videoUrl, 500),
    warmup: warmup.isNotEmpty ? warmup : fallback.warmup,
    main: main.isNotEmpty ? main : fallback.main,
    explicitKeys: true,
  );
}

/// Recovers malformed template payloads by falling back per section instead of failing globally.
Templates sanitizeTemplates(Object? payload, {IdGenerator idGen = generateId}) {
  if (payload is! Map) return {};
  final out = <String, TemplateData>{};
  for (final e in payload.entries) {
    final session = e.key as String;
    if (session.trim().isEmpty) continue;
    out[session] = _sanitizeSessionTemplate(e.value, defaultTemplates[session] ?? emptyTemplate, idGen);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Snapshot migrations: raw stored JSON -> current snapshot shape
// ---------------------------------------------------------------------------

String _iso(DateTime t) => t.toUtc().toIso8601String();

/// Legacy plain record (no envelope) or current envelope; anything else is an empty snapshot.
WorkoutDataSnapshot migrateRawWorkoutSnapshot(Object? raw, {DateTime? now, IdGenerator idGen = generateId}) {
  final stamp = _iso(now ?? DateTime.now());
  if (raw is! Map) return WorkoutDataSnapshot(version: storageSchemaVersion, updatedAt: stamp, data: {});
  if (raw['version'] is! num || !raw.containsKey('data')) {
    return WorkoutDataSnapshot(
      version: storageSchemaVersion,
      updatedAt: stamp,
      data: sanitizeDayDataRecord(raw, idGen: idGen),
    );
  }
  return WorkoutDataSnapshot(
    version: storageSchemaVersion,
    updatedAt: raw['updatedAt'] is String ? raw['updatedAt'] as String : stamp,
    data: sanitizeDayDataRecord(raw['data'], idGen: idGen),
  );
}

TemplateSnapshot migrateRawTemplateSnapshot(Object? raw, {DateTime? now, IdGenerator idGen = generateId}) {
  final stamp = _iso(now ?? DateTime.now());
  if (raw is! Map) return TemplateSnapshot(version: templateSchemaVersion, updatedAt: stamp, data: {});
  if (raw['version'] is! num || !raw.containsKey('templates')) {
    return TemplateSnapshot(version: templateSchemaVersion, updatedAt: stamp, data: sanitizeTemplates(raw, idGen: idGen));
  }
  return TemplateSnapshot(
    version: templateSchemaVersion,
    updatedAt: raw['updatedAt'] is String ? raw['updatedAt'] as String : stamp,
    data: sanitizeTemplates(raw['templates'], idGen: idGen),
  );
}

PlansSnapshot migrateRawPlansSnapshot(Object? raw, {DateTime? now}) {
  final stamp = _iso(now ?? DateTime.now());
  List<Plan> valid(Iterable<Object?> items) =>
      [for (final p in items) if (isValidPlanJson(p)) Plan.fromJson((p as Map).cast<String, Object?>())];

  if (raw is List) return PlansSnapshot(version: plansSchemaVersion, updatedAt: stamp, data: valid(raw));
  if (raw is! Map) return PlansSnapshot(version: plansSchemaVersion, updatedAt: stamp, data: []);
  if (raw['version'] is! num || raw['updatedAt'] is! String || raw['plans'] is! List) {
    return PlansSnapshot(version: plansSchemaVersion, updatedAt: stamp, data: []);
  }
  return PlansSnapshot(
    version: plansSchemaVersion,
    updatedAt: raw['updatedAt'] as String,
    data: valid(raw['plans'] as List),
  );
}
