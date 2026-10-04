/// Dart mirror of the web app's `types.ts`. JSON shapes are identical to what the web app stores and what
/// Postgres rows carry, so data round-trips between clients. Optional fields are omitted (never null) when
/// absent: the content hash depends on that.
library;

import 'js_undefined.dart';

typedef Json = Map<String, Object?>;

String _str(Object? v, [String fallback = '']) => v is String ? v : fallback;
String? _optStr(Object? v) => v is String ? v : null;
int _int(Object? v) => v is num && v.isFinite ? v.round() : 0;

class WorkoutItem {
  const WorkoutItem({
    required this.id,
    required this.text,
    this.target,
    this.equipment,
    this.description,
    this.videoUrl,
    this.done = false,
    this.explicitKeys = false,
  });

  /// True when the sanitiser produced this item: the web app's version of it then carries `target` and
  /// `videoUrl` as explicit `undefined` keys, which its content hash includes (see [toHashJson]).
  final bool explicitKeys;

  final String id;
  final String text;
  final String? target;
  final String? equipment;
  final String? description;
  final String? videoUrl;
  final bool done;

  factory WorkoutItem.fromJson(Json j) => WorkoutItem(
        id: _str(j['id']),
        text: _str(j['text']),
        target: _optStr(j['target']),
        equipment: _optStr(j['equipment']),
        description: _optStr(j['description']),
        videoUrl: _optStr(j['videoUrl']),
        done: j['done'] == true,
        explicitKeys: j['target'] is JsUndefined || j['videoUrl'] is JsUndefined,
      );

  Json toJson() => {
        'id': id,
        'text': text,
        if (target != null) 'target': target,
        if (equipment != null) 'equipment': equipment,
        if (description != null) 'description': description,
        if (videoUrl != null) 'videoUrl': videoUrl,
        'done': done,
      };

  /// The value as the web app hashes it: for a sanitised item, absent `target` / `videoUrl` are explicit
  /// `undefined` keys. Never JSON-encode this; it is for hashing and comparison only.
  Json toHashJson() => explicitKeys
      ? {'id': id, 'text': text, 'target': target ?? jsUndefined, 'videoUrl': videoUrl ?? jsUndefined, 'done': done}
      : toJson();

  WorkoutItem copyWith({bool? done}) => WorkoutItem(
        explicitKeys: explicitKeys,
        id: id,
        text: text,
        target: target,
        equipment: equipment,
        description: description,
        videoUrl: videoUrl,
        done: done ?? this.done,
      );
}

List<WorkoutItem> _items(Object? v) => v is List
    ? [for (final e in v) if (e is Map) WorkoutItem.fromJson(e.cast<String, Object?>())]
    : const [];

class DayData {
  const DayData({
    required this.date,
    required this.sessionType,
    this.warmup = const [],
    this.main = const [],
    this.warmupNotes = '',
    this.mainNotes = '',
    this.warmupTimerMs = 0,
    this.mainTimerMs = 0,
    this.weight = '',
    this.checkNotes = '',
  });

  /// ISO date, `YYYY-MM-DD`.
  final String date;
  final String sessionType;
  final List<WorkoutItem> warmup;
  final List<WorkoutItem> main;
  final String warmupNotes;
  final String mainNotes;
  final int warmupTimerMs;
  final int mainTimerMs;
  final String weight;
  final String checkNotes;

  factory DayData.fromJson(Json j) => DayData(
        date: _str(j['date']),
        sessionType: _str(j['sessionType']),
        warmup: _items(j['warmup']),
        main: _items(j['main']),
        warmupNotes: _str(j['warmupNotes']),
        mainNotes: _str(j['mainNotes']),
        warmupTimerMs: _int(j['warmupTimerMs']),
        mainTimerMs: _int(j['mainTimerMs']),
        weight: _str(j['weight']),
        checkNotes: _str(j['checkNotes']),
      );

  DayData copyWith({
    String? sessionType,
    List<WorkoutItem>? warmup,
    List<WorkoutItem>? main,
    String? warmupNotes,
    String? mainNotes,
    int? warmupTimerMs,
    int? mainTimerMs,
    String? weight,
    String? checkNotes,
  }) =>
      DayData(
        date: date,
        sessionType: sessionType ?? this.sessionType,
        warmup: warmup ?? this.warmup,
        main: main ?? this.main,
        warmupNotes: warmupNotes ?? this.warmupNotes,
        mainNotes: mainNotes ?? this.mainNotes,
        warmupTimerMs: warmupTimerMs ?? this.warmupTimerMs,
        mainTimerMs: mainTimerMs ?? this.mainTimerMs,
        weight: weight ?? this.weight,
        checkNotes: checkNotes ?? this.checkNotes,
      );

  /// See [WorkoutItem.toHashJson].
  Json toHashJson() => {
        ...toJson(),
        'warmup': [for (final i in warmup) i.toHashJson()],
        'main': [for (final i in main) i.toHashJson()],
      };

  Json toJson() => {
        'date': date,
        'sessionType': sessionType,
        'warmup': [for (final i in warmup) i.toJson()],
        'main': [for (final i in main) i.toJson()],
        'warmupNotes': warmupNotes,
        'mainNotes': mainNotes,
        'warmupTimerMs': warmupTimerMs,
        'mainTimerMs': mainTimerMs,
        'weight': weight,
        'checkNotes': checkNotes,
      };
}
