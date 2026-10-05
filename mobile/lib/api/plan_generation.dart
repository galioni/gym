/// Request and response types for `POST /api/generate-plan`, and the wording of its failures (the web app's
/// onboarding wizard). The wire values are the server's validation sets.
library;

import '../domain/models.dart';
import '../domain/templates.dart';
import 'api_client.dart';

enum Goal {
  strength('strength'),
  muscle('muscle'),
  weightLoss('weight_loss'),
  endurance('endurance'),
  active('active');

  const Goal(this.wire);
  final String wire;
}

enum Experience {
  beginner('beginner'),
  intermediate('intermediate'),
  advanced('advanced');

  const Experience(this.wire);
  final String wire;
}

enum Equipment {
  fullGym('full_gym'),
  homeGym('home_gym'),
  minimal('minimal'),
  bodyweight('bodyweight');

  const Equipment(this.wire);
  final String wire;
}

enum SessionDuration {
  min30('30'),
  min45('45'),
  min60('60'),
  min90('90');

  const SessionDuration(this.wire);
  final String wire;
}

enum BodyFocus {
  fullBody('full_body'),
  chest('chest'),
  back('back'),
  shoulders('shoulders'),
  arms('arms'),
  core('core'),
  legs('legs'),
  glutes('glutes'),
  cardio('cardio');

  const BodyFocus(this.wire);
  final String wire;
}

T? _byWire<T extends Enum>(List<T> values, String Function(T) wire, Object? v) {
  for (final e in values) {
    if (wire(e) == v) return e;
  }
  return null;
}

class PlanParams {
  PlanParams({
    required this.goal,
    required this.experience,
    required this.daysPerWeek,
    required this.equipment,
    required this.duration,
    this.bodyFocus = const [],
  }) {
    if (daysPerWeek < 2 || daysPerWeek > 6) throw ArgumentError.value(daysPerWeek, 'daysPerWeek', 'must be 2 to 6');
  }

  final Goal goal;
  final Experience experience;
  final int daysPerWeek;
  final Equipment equipment;
  final SessionDuration duration;
  final List<BodyFocus> bodyFocus;

  /// The shape stored locally and synced as `planParams` (the web app's `PlanParams`).
  Json toJson() => {
        'goal': goal.wire,
        'experience': experience.wire,
        'daysPerWeek': daysPerWeek,
        'equipment': equipment.wire,
        'duration': duration.wire,
        'bodyFocus': [for (final f in bodyFocus) f.wire],
      };

  /// The request body: like [toJson] but `bodyFocus` is left out when empty, as the web app does.
  Json toRequestJson() {
    final json = toJson();
    if (bodyFocus.isEmpty) json.remove('bodyFocus');
    return json;
  }

  /// Null when [j] is not a valid set of parameters (e.g. written by an older web version).
  static PlanParams? tryFromJson(Json? j) {
    if (j == null) return null;
    final goal = _byWire(Goal.values, (e) => e.wire, j['goal']);
    final experience = _byWire(Experience.values, (e) => e.wire, j['experience']);
    final equipment = _byWire(Equipment.values, (e) => e.wire, j['equipment']);
    final duration = _byWire(SessionDuration.values, (e) => e.wire, j['duration']);
    final days = j['daysPerWeek'];
    if (goal == null || experience == null || equipment == null || duration == null) return null;
    if (days is! int || days < 2 || days > 6) return null;
    final focus = j['bodyFocus'];
    return PlanParams(
      goal: goal,
      experience: experience,
      daysPerWeek: days,
      equipment: equipment,
      duration: duration,
      bodyFocus: focus is List
          ? [for (final f in focus) ?_byWire(BodyFocus.values, (e) => e.wire, f)]
          : const [],
    );
  }
}

/// One line describing what a plan was generated from, for Settings: "Build muscle · Intermediate · 4 days/week · Full gym · 60 min".
String describePlanParams(PlanParams p) {
  final goal = switch (p.goal) {
    Goal.strength => 'Build strength',
    Goal.muscle => 'Build muscle',
    Goal.weightLoss => 'Lose weight',
    Goal.endurance => 'Improve endurance',
    Goal.active => 'Stay active',
  };
  final experience = switch (p.experience) {
    Experience.beginner => 'Beginner',
    Experience.intermediate => 'Intermediate',
    Experience.advanced => 'Advanced',
  };
  final equipment = switch (p.equipment) {
    Equipment.fullGym => 'Full gym',
    Equipment.homeGym => 'Home gym',
    Equipment.minimal => 'Minimal',
    Equipment.bodyweight => 'Bodyweight',
  };
  final focus = [
    for (final f in p.bodyFocus)
      switch (f) {
        BodyFocus.fullBody => 'Full body',
        BodyFocus.chest => 'Chest',
        BodyFocus.back => 'Back',
        BodyFocus.shoulders => 'Shoulders',
        BodyFocus.arms => 'Arms',
        BodyFocus.core => 'Core / Abs',
        BodyFocus.legs => 'Legs',
        BodyFocus.glutes => 'Glutes',
        BodyFocus.cardio => 'Cardio',
      },
  ];
  return [goal, experience, '${p.daysPerWeek} days/week', equipment, '${p.duration.wire} min', ...focus].join(' · ');
}

class GeneratedPlan {
  const GeneratedPlan({required this.templates, this.split, this.schedule, this.progression, this.notes});

  /// Session type -> template, each tagged `source: ai`.
  final Templates templates;
  final String? split;
  final List<String>? schedule;
  final String? progression;
  final String? notes;

  /// The `planMeta` to store: only when the server sent the full new-style plan (split, schedule, progression).
  Json? get meta {
    final s = split;
    final sch = schedule;
    final p = progression;
    if (s == null || s.isEmpty || sch == null || p == null || p.isEmpty) return null;
    return {'split': s, 'schedule': sch, 'progression': p, if (notes != null) 'notes': notes};
  }
}

String _plural(int n, String unit) => '$n $unit${n == 1 ? '' : 's'}';

/// A wait in plain language, rounded up so nobody retries too early: "1 minute", "5 hours", "2 days".
String formatRetryWait(int seconds) {
  const minute = 60, hour = 3600, day = 86400;
  if (seconds <= minute) return '1 minute';
  if (seconds < hour) return _plural((seconds / minute).ceil(), 'minute');
  if (seconds <= 48 * hour) return _plural((seconds / hour).ceil(), 'hour');
  return _plural((seconds / day).ceil(), 'day');
}

class GeneratePlanFailure {
  const GeneratePlanFailure(this.message, {this.offersUpgrade = false});

  final String message;

  /// True when the refusal was the Free plan's limit, so the UI can offer Pro.
  final bool offersUpgrade;
}

/// What to tell the user when plan generation fails; same wording and branching as the web wizard.
GeneratePlanFailure describeGeneratePlanError(ApiException e) {
  if (e.isNetwork) return GeneratePlanFailure(e.message);
  if (e.isRateLimited) {
    final retry = e.retryAfterSeconds;
    final wait = retry != null && retry > 0 ? ' Try again in ${formatRetryWait(retry)}.' : ' Try again later.';
    // A refusal that names the plan carries its own explanation (what Free includes, what Pro adds).
    final reason = e.plan != null && e.message.isNotEmpty ? e.message : "You've hit the plan generation limit.";
    return GeneratePlanFailure('$reason$wait', offersUpgrade: e.plan == 'free');
  }
  if (e.isServerError) {
    return const GeneratePlanFailure('Plan generation failed due to a server error. Please try again in a moment.');
  }
  return GeneratePlanFailure(e.message.isNotEmpty ? e.message : 'Plan generation failed. Please try again.');
}
