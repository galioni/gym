/// JSON forms of the snapshots: used to keep restore points (raw JSON on disk) and to validate them before
/// trusting them. `tryParse` is the web app's "integrity check": null unless the envelope is intact.
library;

import '../domain/models.dart';
import '../domain/rules.dart';
import '../domain/templates.dart';
import 'sync_types.dart';

extension WorkoutSnapshotJson on WorkoutDataSnapshot {
  Json toJson() => {
        'version': version,
        'updatedAt': updatedAt,
        'data': {for (final e in data.entries) e.key: e.value.toJson()},
        if (deletedDays != null) 'deletedDays': deletedDays,
      };

  static WorkoutDataSnapshot? tryParse(Object? raw) {
    if (raw is! Map || raw['version'] is! num || raw['updatedAt'] is! String || raw['data'] is! Map) return null;
    final deleted = raw['deletedDays'];
    return WorkoutDataSnapshot(
      version: (raw['version'] as num).toInt(),
      updatedAt: raw['updatedAt'] as String,
      data: sanitizeDayDataRecord(raw['data']),
      deletedDays: deleted is Map
          ? {for (final e in deleted.entries) if (e.value is String) e.key as String: e.value as String}
          : null,
    );
  }
}

extension TemplateSnapshotJson on TemplateSnapshot {
  Json toJson() => {'version': version, 'updatedAt': updatedAt, 'data': templatesToJson(data)};

  static TemplateSnapshot? tryParse(Object? raw) {
    if (raw is! Map || raw['version'] is! num || raw['updatedAt'] is! String || raw['data'] is! Map) return null;
    return TemplateSnapshot(
      version: (raw['version'] as num).toInt(),
      updatedAt: raw['updatedAt'] as String,
      data: sanitizeTemplates(raw['data']),
    );
  }
}

extension PlansSnapshotJson on PlansSnapshot {
  Json toJson() => {'version': version, 'updatedAt': updatedAt, 'data': [for (final p in data) p.toJson()]};

  static PlansSnapshot? tryParse(Object? raw) {
    if (raw is! Map || raw['version'] is! num || raw['updatedAt'] is! String || raw['data'] is! List) return null;
    return PlansSnapshot(
      version: (raw['version'] as num).toInt(),
      updatedAt: raw['updatedAt'] as String,
      data: [
        for (final p in raw['data'] as List)
          if (isValidPlanJson(p)) Plan.fromJson((p as Map).cast<String, Object?>()),
      ],
    );
  }
}
