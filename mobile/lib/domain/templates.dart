/// Templates and plans: Dart mirror of `TemplateData`, `Templates` and `Plan` in the web app's `types.ts`.
/// Optional fields are omitted (never null) in JSON so stored values hash the same as the web app's.
library;

import 'js_undefined.dart';
import 'models.dart';

String? _optStr(Object? v) => v is String ? v : null;

class TemplateRow {
  const TemplateRow({
    required this.text,
    this.id,
    this.target,
    this.equipment,
    this.description,
    this.videoUrl,
    this.explicitKeys = false,
  });

  /// True when the sanitiser produced this row (see [toHashJson]).
  final bool explicitKeys;

  final String? id;
  final String text;
  final String? target;
  final String? equipment;
  final String? description;
  final String? videoUrl;

  factory TemplateRow.fromJson(Json j) => TemplateRow(
        id: _optStr(j['id']),
        text: j['text'] is String ? j['text'] as String : '',
        target: _optStr(j['target']),
        equipment: _optStr(j['equipment']),
        description: _optStr(j['description']),
        videoUrl: _optStr(j['videoUrl']),
        explicitKeys: j['target'] is JsUndefined ||
            j['equipment'] is JsUndefined ||
            j['description'] is JsUndefined ||
            j['videoUrl'] is JsUndefined,
      );

  /// The value as the web app hashes it: a sanitised row carries every optional key, absent ones as explicit
  /// `undefined`. Never JSON-encode this; it is for hashing and comparison only.
  Json toHashJson() => explicitKeys
      ? {
          'id': id ?? jsUndefined,
          'text': text,
          'target': target ?? jsUndefined,
          'equipment': equipment ?? jsUndefined,
          'description': description ?? jsUndefined,
          'videoUrl': videoUrl ?? jsUndefined,
        }
      : toJson();

  Json toJson() => {
        if (id != null) 'id': id,
        'text': text,
        if (target != null) 'target': target,
        if (equipment != null) 'equipment': equipment,
        if (description != null) 'description': description,
        if (videoUrl != null) 'videoUrl': videoUrl,
      };
}

List<TemplateRow> _rows(Object? v) => v is List
    ? [for (final e in v) if (e is Map) TemplateRow.fromJson(e.cast<String, Object?>())]
    : const [];

class TemplateData {
  const TemplateData({
    this.warmup = const [],
    this.main = const [],
    this.source,
    this.label,
    this.focus,
    this.videoUrl,
    this.explicitKeys = false,
  });

  /// True when the sanitiser produced this template (see [toHashJson]).
  final bool explicitKeys;

  /// `ai` or `user`.
  final String? source;
  final String? label;
  final String? focus;
  final String? videoUrl;
  final List<TemplateRow> warmup;
  final List<TemplateRow> main;

  factory TemplateData.fromJson(Json j) => TemplateData(
        source: _optStr(j['source']),
        label: _optStr(j['label']),
        focus: _optStr(j['focus']),
        videoUrl: _optStr(j['videoUrl']),
        warmup: _rows(j['warmup']),
        main: _rows(j['main']),
        explicitKeys: j['source'] is JsUndefined ||
            j['label'] is JsUndefined ||
            j['focus'] is JsUndefined ||
            j['videoUrl'] is JsUndefined,
      );

  /// See [TemplateRow.toHashJson].
  Json toHashJson() => {
        if (explicitKeys) ...{
          'source': source ?? jsUndefined,
          'label': label ?? jsUndefined,
          'focus': focus ?? jsUndefined,
          'videoUrl': videoUrl ?? jsUndefined,
        } else ...{
          if (source != null) 'source': source,
          if (label != null) 'label': label,
          if (focus != null) 'focus': focus,
          if (videoUrl != null) 'videoUrl': videoUrl,
        },
        'warmup': [for (final r in warmup) r.toHashJson()],
        'main': [for (final r in main) r.toHashJson()],
      };

  /// A copy with a different label (rename). The other fields, including [explicitKeys], are kept.
  TemplateData withLabel(String? newLabel) => TemplateData(
        explicitKeys: explicitKeys,
        source: source,
        label: newLabel,
        focus: focus,
        videoUrl: videoUrl,
        warmup: warmup,
        main: main,
      );

  TemplateData withSource(String? newSource) => TemplateData(
        explicitKeys: explicitKeys,
        source: newSource,
        label: label,
        focus: focus,
        videoUrl: videoUrl,
        warmup: warmup,
        main: main,
      );

  Json toJson() => {
        if (source != null) 'source': source,
        if (label != null) 'label': label,
        if (focus != null) 'focus': focus,
        if (videoUrl != null) 'videoUrl': videoUrl,
        'warmup': [for (final r in warmup) r.toJson()],
        'main': [for (final r in main) r.toJson()],
      };
}

/// Session type -> template. Insertion order is the display order.
typedef Templates = Map<String, TemplateData>;

Json templatesToJson(Templates t) => {for (final e in t.entries) e.key: e.value.toJson()};

/// Templates in the form the web app hashes (see [TemplateRow.toHashJson]).
Json templatesToHashJson(Templates t) => {for (final e in t.entries) e.key: e.value.toHashJson()};

class Plan {
  const Plan({required this.id, required this.label, required this.sessionIds, this.schedule});

  final String id;
  final String label;

  /// Session types from the shared templates pool.
  final List<String> sessionIds;

  /// Optional day assignments: `"0"` (Monday) .. `"6"` (Sunday) -> session type.
  final Map<String, String>? schedule;

  /// Callers must have checked [isValidPlanJson].
  factory Plan.fromJson(Json j) {
    final s = j['schedule'];
    return Plan(
      id: j['id'] as String,
      label: j['label'] as String,
      sessionIds: (j['sessionIds'] as List).cast<String>(),
      schedule: s is Map
          ? {for (final e in s.entries) if (e.key is String && e.value is String) e.key as String: e.value as String}
          : null,
    );
  }

  Json toJson() => {
        'id': id,
        'label': label,
        'sessionIds': sessionIds,
        if (schedule != null) 'schedule': schedule,
      };
}

bool isValidPlanJson(Object? v) =>
    v is Map &&
    v['id'] is String &&
    v['label'] is String &&
    v['sessionIds'] is List &&
    (v['sessionIds'] as List).every((s) => s is String);
