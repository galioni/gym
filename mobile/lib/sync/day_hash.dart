import '../domain/models.dart';
import 'content_hash.dart';

/// Content fingerprint of one workout day; the identity used by deletion tombstones and the three-way merge.
String dayContentHash(DayData day) => entityHash(day.toHashJson());
