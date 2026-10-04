/// Port of `application/sync/collections.ts`: adapters between the snapshot shapes the repositories speak and
/// the keyed [Collection] the merge speaks. Each pair is lossless.
library;

import '../domain/templates.dart';
import 'sync_merge.dart';
import 'sync_types.dart';

Collection templatesToCollection(Templates templates) => Collection(
      templates.keys.toList(),
      {for (final e in templates.entries) e.key: e.value.toHashJson()},
    );

Templates collectionToTemplates(Collection c) => {
      for (final k in c.keys) k: TemplateData.fromJson((c.items[k] as Map).cast<String, Object?>()),
    };

Collection plansToCollection(List<Plan> plans) => Collection(
      [for (final p in plans) p.id],
      {for (final p in plans) p.id: p.toJson()},
    );

List<Plan> collectionToPlans(Collection c) =>
    [for (final k in c.keys) Plan.fromJson((c.items[k] as Map).cast<String, Object?>())];

const _settingsFields = ['activePlanId', 'planParams', 'planMeta'];

/// A null field is "not set", so setting it to null on one device is a deletion the merge can propagate.
Collection settingsToCollection(SyncedSettings s) {
  final values = <String, Object?>{'activePlanId': s.activePlanId, 'planParams': s.planParams, 'planMeta': s.planMeta};
  final keys = [for (final f in _settingsFields) if (values[f] != null) f];
  return Collection(keys, {for (final k in keys) k: values[k]});
}

SyncedSettings collectionToSettings(Collection c) => SyncedSettings(
      activePlanId: c.items['activePlanId'] as String?,
      planParams: (c.items['planParams'] as Map?)?.cast<String, Object?>(),
      planMeta: (c.items['planMeta'] as Map?)?.cast<String, Object?>(),
    );
