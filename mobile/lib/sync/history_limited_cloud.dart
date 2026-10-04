/// The cloud as the Free plan uses it (`HistoryLimitedCloudWorkout` in `historyWindow.ts`): reading is untouched,
/// but nothing older than the window is ever sent, whether as a day or as a deletion. It only narrows what this
/// device uploads; it never removes anything, on the device or in the cloud.
library;

import '../data/repositories.dart';
import '../domain/models.dart';
import 'sync_merge.dart' show keepRecent;
import 'sync_types.dart';

class HistoryLimitedCloudWorkout implements WorkoutDataRepository {
  HistoryLimitedCloudWorkout(this._inner, this._cutoff);

  final WorkoutDataRepository _inner;
  final String _cutoff;

  @override
  Future<Map<String, DayData>> readAll() => _inner.readAll();

  @override
  Future<WorkoutDataSnapshot?> readSnapshot() => _inner.readSnapshot();

  @override
  Future<void> writeAll(Map<String, DayData> data) => _inner.writeAll(keepRecent(data, _cutoff));

  @override
  Future<void> writeSnapshot(WorkoutDataSnapshot snapshot) => _inner.writeSnapshot(
        WorkoutDataSnapshot(
          version: snapshot.version,
          updatedAt: snapshot.updatedAt,
          data: keepRecent(snapshot.data, _cutoff),
          deletedDays: snapshot.deletedDays == null ? null : keepRecent(snapshot.deletedDays!, _cutoff),
        ),
      );

  @override
  Future<void> recordDeletion(String date, DayData day) => _inner.recordDeletion(date, day);
}
