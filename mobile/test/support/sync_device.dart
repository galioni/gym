import 'package:daily_grind/data/postgres_repositories.dart';
import 'package:daily_grind/domain/models.dart';
import 'package:daily_grind/domain/templates.dart';
import 'package:daily_grind/sync/sync_allowance.dart';
import 'package:daily_grind/sync/sync_errors.dart';
import 'package:daily_grind/sync/sync_service.dart';

import 'fake_gateway.dart';
import 'local_doubles.dart';

/// One device running the real sync service and the real Postgres repositories against a fake database, with
/// local storage doubles. Shared by the contract replay and the engine tests.
DayData mkDay(String date, String notes) => DayData(
      date: date,
      sessionType: 'yoga',
      main: [WorkoutItem(id: 'i-$date', text: 'Move')],
      mainNotes: notes,
    );
TemplateData mkTemplate(String label) =>
    TemplateData(label: label, main: [TemplateRow(id: 'r-$label', text: label, target: '3x8')]);
Plan mkPlan(String id, String label) => Plan(id: id, label: label, sessionIds: const ['a', 'b']);

class TestAllowance implements SyncAllowance {
  int? historyDays;
  String? refuseNextAvailable;
  bool refuse = false;

  @override
  Future<SyncGrant> begin() async {
    if (refuse) throw SyncAllowanceError(refuseNextAvailable);
    return SyncGrant(historyDays: historyDays);
  }

  @override
  Future<SyncAllowanceStatus> status() async => SyncAllowanceStatus.unlimited;
}

class TestOwnership implements SyncOwnership {
  OwnerStatus value = OwnerStatus.ok;

  @override
  Future<OwnerStatus> check() async => value;
}

class Device {
  Device(this.gateway, this.clock) {
    days = LocalDays(clock);
    templates = LocalTemplates(clock);
    account = LocalSettings(clock);
    service = SyncService(
      settingsRepository: settings,
      allowance: allowance,
      ownership: ownership,
      localWorkoutRepository: days,
      localTemplateRepository: templates,
      localPlansRepository: plans,
      localSettingsRepository: account,
      cloudWorkoutRepository: PostgresWorkoutDataRepository(gateway, now: clock),
      cloudTemplateRepository: PostgresTemplateRepository(gateway, now: clock),
      cloudPlansRepository: PostgresPlansRepository(gateway, now: clock),
      cloudSettingsRepository: PostgresAccountSettingsRepository(gateway, now: clock),
      now: clock,
    );
  }

  final FakeGateway gateway;
  final DateTime Function() clock;
  late final LocalDays days;
  late final LocalTemplates templates;
  final plans = LocalPlans();
  late final LocalSettings account;
  final settings = SyncSettingsMemory();
  final allowance = TestAllowance();
  final ownership = TestOwnership();
  late final SyncService service;
}

