/// The account-level data the screens read and edit: session templates, plans and which plan is active (the web app's
/// `useTemplates` and `usePlans`).
///
/// Template edits apply to memory first and are then saved and read back, so what the screens hold is always what storage
/// holds (cleaned up, with ids) and never a half-edited copy. A failed save keeps the edit on screen and reports
/// [lastTemplateError], as the web app does.
library;

import 'package:flutter/foundation.dart';

import '../data/repositories.dart';
import '../domain/defaults.dart';
import '../domain/models.dart';
import '../domain/rules.dart';
import '../domain/session_types.dart';
import '../domain/template_rules.dart';
import '../domain/templates.dart';
import '../domain/workout_transitions.dart';
import '../sync/sync_types.dart';

const templateSaveFailed = 'Failed to save template changes.';

class Workspace extends ChangeNotifier {
  Workspace({
    required TemplateRepository templates,
    required PlansRepository plans,
    AccountSettingsRepository? account,
    this.now = DateTime.now,
    this.idGen = generateId,
  })  : _templateRepo = templates,
        _planRepo = plans,
        _accountRepo = account;

  final TemplateRepository _templateRepo;
  final PlansRepository _planRepo;
  final AccountSettingsRepository? _accountRepo;
  final DateTime Function() now;
  final IdGenerator idGen;
  bool _disposed = false;

  Templates _templates = defaultTemplates;
  List<Plan> _plans = const [];
  String? _activePlanId;
  Json? _planParams;
  Json? _planMeta;
  bool _isLoaded = false;
  String? _lastTemplateError;
  int _revision = 0;

  // The rows a section had before its last save or reset, so "Undo" can put them back.
  final _history = <String, Map<WorkoutSection, List<TemplateRow>>>{};

  /// Session type -> template. Until something is stored this is the built-in set, as on the web.
  Templates get templates => _templates;
  List<Plan> get plans => _plans;
  String? get activePlanId => _activePlanId;
  bool get isLoaded => _isLoaded;

  /// What the account's AI plan was generated from (goal, experience, days...), and the plan's own description (split,
  /// progression, notes). Both sync with the account; null until a plan has been generated.
  Json? get planParams => _planParams;
  Json? get planMeta => _planMeta;

  /// The last failure to save a template change, cleared by the next one that succeeds.
  String? get lastTemplateError => _lastTemplateError;

  /// Counts changes to templates, plans and the active plan (an edit or a load), so a listener can tell they changed.
  int get revision => _revision;

  Plan? get activePlan {
    for (final p in _plans) {
      if (p.id == _activePlanId) return p;
    }
    return null;
  }

  /// Every session the account has, built-ins first.
  List<SessionOption> get allSessionOptions => getSessionOptions(_templates);

  /// The sessions the day screen's picker offers: with an active plan, only the ones it includes.
  List<SessionOption> get sessionOptions {
    final plan = activePlan;
    if (plan == null || plan.sessionIds.isEmpty) return allSessionOptions;
    return [for (final o in allSessionOptions) if (plan.sessionIds.contains(o.value)) o];
  }

  /// The "Watch" link of a session's template, if it has one.
  String? videoUrlFor(String sessionType) => _templates[sessionType]?.videoUrl;

  void _changed() {
    _revision++;
    if (!_disposed) notifyListeners();
  }

  /// Reads everything again (first load, or storage changed because a sync wrote to it).
  Future<void> load() async {
    try {
      final stored = await _templateRepo.readTemplates();
      final plans = await _planRepo.readPlans();
      final active = await _planRepo.readActivePlanId();
      final account = await _accountRepo?.readSnapshot();
      if (_disposed) return;
      _planParams = account?.data.planParams;
      _planMeta = account?.data.planMeta;
      _templates = sanitizeTemplates(templatesToJson(stored ?? defaultTemplates));
      _plans = plans;
      _activePlanId = active;
    } catch (e) {
      debugPrint('Failed to load templates and plans: $e');
    } finally {
      _isLoaded = true;
      _changed();
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------------------------------------------

  TemplateData _templateOf(String session) => _templates[session] ?? emptyTemplate;

  List<TemplateRow> _rows(TemplateData t, WorkoutSection s) => s == WorkoutSection.warmup ? t.warmup : t.main;

  TemplateData _withRows(TemplateData t, WorkoutSection s, List<TemplateRow> rows) => TemplateData(
        source: t.source,
        label: t.label,
        focus: t.focus,
        videoUrl: t.videoUrl,
        explicitKeys: t.explicitKeys,
        warmup: s == WorkoutSection.warmup ? rows : t.warmup,
        main: s == WorkoutSection.main ? rows : t.main,
      );

  /// Applies [next] now, saves it, then shows what was stored. True when it was saved.
  Future<bool> _persistTemplates(Templates next) async {
    _templates = next;
    _lastTemplateError = null;
    _changed();
    try {
      await _templateRepo.writeTemplates(next);
      final stored = await _templateRepo.readTemplates();
      if (_disposed) return true;
      if (stored != null) _templates = stored;
      _changed();
      return true;
    } catch (e) {
      debugPrint('Failed to save templates: $e');
      _lastTemplateError = templateSaveFailed;
      _changed();
      return false;
    }
  }

  /// Saves the rows of one section of a session. Returns the problems that stopped it (nothing is saved then).
  Future<List<TemplateValidationError>> saveSection(String session, WorkoutSection section, List<TemplateRow> rows) async {
    final errors = validateTemplateRows([for (final r in rows) (text: r.text, target: r.target)]);
    if (errors.isNotEmpty) return errors;
    final current = _templateOf(session);
    _history.putIfAbsent(session, () => {})[section] = _rows(current, section);
    await _persistTemplates({..._templates, session: _withRows(current, section, rows)});
    return const [];
  }

  /// Puts back the rows the section had before its last save or reset. False when there is nothing to undo.
  Future<bool> undoSection(String session, WorkoutSection section) async {
    final previous = _history[session]?.remove(section);
    if (previous == null) return false;
    await _persistTemplates({..._templates, session: _withRows(_templateOf(session), section, previous)});
    return true;
  }

  /// Replaces a section with the built-in rows for that session (empty for a session the user made).
  Future<void> resetSection(String session, WorkoutSection section) async {
    final current = _templateOf(session);
    _history.putIfAbsent(session, () => {})[section] = _rows(current, section);
    final defaults = _rows(getDefaultTemplate(session), section);
    await _persistTemplates({..._templates, session: _withRows(current, section, defaults)});
  }

  /// Sets or clears (null or empty) the "Watch" link of a whole session.
  Future<void> saveVideoUrl(String session, String? url) async {
    final t = _templateOf(session);
    final clean = url == null || url.isEmpty ? null : url;
    await _persistTemplates({
      ..._templates,
      session: TemplateData(
        source: t.source,
        label: t.label,
        focus: t.focus,
        videoUrl: clean,
        explicitKeys: t.explicitKeys,
        warmup: t.warmup,
        main: t.main,
      ),
    });
  }

  /// Replaces every template at once (a freshly generated plan).
  Future<void> replaceTemplates(Templates next) async {
    _history.clear();
    if (!await _persistTemplates(next)) throw StateError(templateSaveFailed);
  }

  Future<SessionTypeResult> addSessionType(String label) async {
    final result = createSessionType(_templates, label);
    if (!result.ok || result.templates == null) return result;
    if (!await _persistTemplates(result.templates!)) {
      return const SessionTypeResult(RuleStatus.error, templateSaveFailed);
    }
    return result;
  }

  Future<SessionTypeResult> removeSessionType(String sessionType) async {
    final result = deleteSessionType(_templates, sessionType);
    if (!result.ok || result.templates == null) return result;
    _history.remove(sessionType);
    if (!await _persistTemplates(result.templates!)) {
      return const SessionTypeResult(RuleStatus.error, templateSaveFailed);
    }
    return result;
  }

  Future<SessionTypeResult> renameSession(String sessionType, String newLabel) async {
    final result = renameSessionType(_templates, sessionType, newLabel);
    if (!result.ok || result.templates == null) return result;
    if (!await _persistTemplates(result.templates!)) {
      return const SessionTypeResult(RuleStatus.error, templateSaveFailed);
    }
    return result;
  }

  /// Stores what the AI plan was generated from, and its description (null clears it: a plan without one must not keep the
  /// previous plan's text). The active plan is left as it is.
  Future<void> savePlanDetails(Json? params, Json? meta) async {
    final repo = _accountRepo;
    if (repo == null) return;
    final current = (await repo.readSnapshot())?.data;
    await repo.writeSnapshot(SettingsSnapshot(
      version: 1,
      updatedAt: now().toUtc().toIso8601String(),
      data: SyncedSettings(activePlanId: current?.activePlanId, planParams: params, planMeta: meta),
    ));
    _planParams = params;
    _planMeta = meta;
    _changed();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Plans
  // ---------------------------------------------------------------------------------------------------------------

  /// Adds a plan. [schedule] (day index "0" Monday .. "6" Sunday -> session) is kept only if it assigns something.
  Future<Plan> createPlan(String label, List<String> sessionIds, {Map<String, String>? schedule}) async {
    // Millisecond plus five random characters is unique in practice; make it so, in case two are made in the same instant.
    String candidate() => 'plan_${now().millisecondsSinceEpoch}_${idGen().substring(0, 5)}';
    final base = candidate();
    var id = base;
    var n = 0;
    while (_plans.any((p) => p.id == id)) {
      id = '${base}_${++n}';
    }
    final plan = Plan(
      id: id,
      label: label.trim(),
      sessionIds: List.of(sessionIds),
      schedule: schedule != null && schedule.isNotEmpty ? Map.of(schedule) : null,
    );
    final next = [..._plans, plan];
    await _planRepo.writePlans(next);
    _plans = next;
    _changed();
    return plan;
  }

  /// Replaces a plan's label, sessions and schedule (a null or empty [schedule] clears it).
  Future<void> updatePlan(String id, {required String label, required List<String> sessionIds, Map<String, String>? schedule}) async {
    final next = [
      for (final p in _plans)
        p.id == id
            ? Plan(
                id: p.id,
                label: label.trim(),
                sessionIds: List.of(sessionIds),
                schedule: schedule != null && schedule.isNotEmpty ? Map.of(schedule) : null,
              )
            : p,
    ];
    await _planRepo.writePlans(next);
    _plans = next;
    _changed();
  }

  /// Removes a plan. If it was the active one, no plan is active afterwards.
  Future<void> deletePlan(String id) async {
    final next = [for (final p in _plans) if (p.id != id) p];
    await _planRepo.writePlans(next);
    if (_activePlanId == id) {
      await _planRepo.writeActivePlanId(null);
      _activePlanId = null;
    }
    _plans = next;
    _changed();
  }

  Future<void> setActivePlan(String? id) async {
    await _planRepo.writeActivePlanId(id);
    _activePlanId = id;
    _changed();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
