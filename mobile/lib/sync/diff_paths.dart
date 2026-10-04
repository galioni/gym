/// Port of `collectDiffPaths` in `SyncService.ts`: the dotted paths where two values differ, for the conflict
/// preview ("2026-10-01.mainNotes"). Order follows JavaScript's object key order (integer-like keys first,
/// ascending) so the first few paths, which are all the UI shows, match the web app's.
library;

import 'content_hash.dart';

final _arrayIndex = RegExp(r'^(0|[1-9][0-9]*)$');

List<String> _jsKeyOrder(Iterable<String> keys) {
  final indices = [for (final k in keys) if (_arrayIndex.hasMatch(k)) k]..sort((a, b) => int.parse(a).compareTo(int.parse(b)));
  return [...indices, for (final k in keys) if (!_arrayIndex.hasMatch(k)) k];
}

bool _isObject(Object? v) => v is Map || v is List;

List<String> collectDiffPaths(Object? local, Object? cloud, [String path = '', int limit = 50]) {
  if (limit <= 0) return [];
  if (!_isObject(local) || !_isObject(cloud)) {
    return stableSerialize(local) == stableSerialize(cloud) ? [] : [path.isEmpty ? '(root)' : path];
  }
  if ((local is List) != (cloud is List)) return [path.isEmpty ? '(root)' : path];

  final List<String> keys;
  if (local is List && cloud is List) {
    final n = local.length > cloud.length ? local.length : cloud.length;
    keys = [for (var i = 0; i < n; i++) '$i'];
  } else {
    final l = (local as Map).keys.cast<String>().toList();
    final c = (cloud as Map).keys.cast<String>();
    keys = _jsKeyOrder([...l, ...c.where((k) => !l.contains(k))]);
  }

  Object? child(Object? container, String key) {
    if (container is List) {
      final i = int.parse(key);
      return i < container.length ? container[i] : null;
    }
    return (container as Map)[key];
  }

  final diffs = <String>[];
  for (final key in keys) {
    if (diffs.length >= limit) break;
    diffs.addAll(collectDiffPaths(child(local, key), child(cloud, key), path.isEmpty ? key : '$path.$key', limit - diffs.length));
  }
  return diffs;
}
