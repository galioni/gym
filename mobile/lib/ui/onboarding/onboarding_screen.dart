import 'dart:async';

import 'package:flutter/material.dart';

import '../../api/api_client.dart';
import '../../api/plan_generation.dart';
import '../app_scope.dart';

class _Option<T> {
  const _Option(this.value, this.label, [this.sub]);

  final T value;
  final String label;
  final String? sub;
}

const _goals = [
  _Option(Goal.strength, 'Build strength', 'Compound lifts, progressive overload'),
  _Option(Goal.muscle, 'Build muscle', 'Volume-focused, 8–15 reps'),
  _Option(Goal.weightLoss, 'Lose weight', 'Mixed cardio + resistance'),
  _Option(Goal.endurance, 'Improve endurance', 'Cardio & conditioning'),
  _Option(Goal.active, 'Stay active', 'General fitness, feel good'),
];

const _experienceOptions = [
  _Option(Experience.beginner, 'Beginner', 'Less than 1 year'),
  _Option(Experience.intermediate, 'Intermediate', '1–3 years'),
  _Option(Experience.advanced, 'Advanced', '3+ years'),
];

const _equipment = [
  _Option(Equipment.fullGym, 'Full gym', 'Barbells, machines, cables'),
  _Option(Equipment.homeGym, 'Home gym', 'Dumbbells & barbell'),
  _Option(Equipment.minimal, 'Minimal', 'Bands & bodyweight'),
  _Option(Equipment.bodyweight, 'Bodyweight', 'No equipment'),
];

const _bodyFocus = [
  _Option(BodyFocus.fullBody, 'Full body'),
  _Option(BodyFocus.chest, 'Chest'),
  _Option(BodyFocus.back, 'Back'),
  _Option(BodyFocus.shoulders, 'Shoulders'),
  _Option(BodyFocus.arms, 'Arms'),
  _Option(BodyFocus.core, 'Core / Abs'),
  _Option(BodyFocus.legs, 'Legs'),
  _Option(BodyFocus.glutes, 'Glutes'),
  _Option(BodyFocus.cardio, 'Cardio'),
];

const _durations = [
  _Option(SessionDuration.min30, '30 min'),
  _Option(SessionDuration.min45, '45 min'),
  _Option(SessionDuration.min60, '60 min'),
  _Option(SessionDuration.min90, '90 min'),
];

const _generatingSteps = [
  'Analysing your goals...',
  'Selecting exercises...',
  'Building your schedule...',
  'Finalising your plan...',
];

/// First-run setup (and "Rebuild your plan" from Settings): a few questions, then an AI-generated set of session templates.
/// Port of the web app's onboarding wizard.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, this.initial});

  /// The answers from the plan being rebuilt; null on first run.
  final PlanParams? initial;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  late Goal? _goal = widget.initial?.goal;
  late Experience? _experience = widget.initial?.experience;
  late int? _days = widget.initial?.daysPerWeek;
  late Equipment? _equip = widget.initial?.equipment;
  late SessionDuration? _duration = widget.initial?.duration;
  late final Set<BodyFocus> _focus = {...?widget.initial?.bodyFocus};

  bool _generating = false;
  String? _error;
  bool _errorOffersUpgrade = false;

  bool get _isRebuilding => widget.initial != null;
  bool get _canGenerate => _goal != null && _experience != null && _days != null && _equip != null && _duration != null;

  Future<void> _generate() async {
    if (!_canGenerate || _generating) return;
    final services = AppScope.of(context);
    final api = services.api;
    if (api == null) {
      setState(() => _error = 'Plan generation is not available right now.');
      return;
    }
    setState(() {
      _generating = true;
      _error = null;
      _errorOffersUpgrade = false;
    });
    final params = PlanParams(
      goal: _goal!,
      experience: _experience!,
      daysPerWeek: _days!,
      equipment: _equip!,
      duration: _duration!,
      bodyFocus: [for (final b in BodyFocus.values) if (_focus.contains(b)) b],
    );
    try {
      final plan = await api.generatePlan(params);
      await services.completeOnboarding(plan, params);
      // The screen is replaced by the day screen once the account counts as set up.
    } on ApiException catch (e) {
      final failure = describeGeneratePlanError(e);
      if (mounted) {
        setState(() {
          _error = failure.message;
          _errorOffersUpgrade = failure.offersUpgrade;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Something went wrong. Please try again.');
    } finally {
      if (mounted) setState(() => _generating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final services = AppScope.of(context);

    Widget section(String label, Widget child) => Padding(
          padding: const EdgeInsets.only(bottom: 20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label.toUpperCase(), style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 1.6, fontWeight: FontWeight.w700, color: scheme.onSurfaceVariant)),
            const SizedBox(height: 8),
            child,
          ]),
        );

    Widget cards<T>(List<_Option<T>> options, T? selected, ValueChanged<T> onTap, {int columns = 1}) => LayoutBuilder(
          builder: (context, box) {
            final gap = 8.0;
            final width = columns == 1 ? box.maxWidth : (box.maxWidth - gap * (columns - 1)) / columns;
            return Wrap(spacing: gap, runSpacing: gap, children: [
              for (final o in options)
                SizedBox(
                  width: width,
                  child: _OptionCard(label: o.label, sub: o.sub, selected: selected == o.value, onTap: () => onTap(o.value)),
                ),
            ]);
          },
        );

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Column(children: [
                    Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                      Icon(Icons.fitness_center, color: scheme.primary),
                      const SizedBox(width: 8),
                      Text('DAILY GRIND', style: theme.textTheme.labelMedium?.copyWith(letterSpacing: 2.4, fontWeight: FontWeight.w700, color: scheme.primary)),
                    ]),
                    const SizedBox(height: 8),
                    Text(_isRebuilding ? 'Rebuild your plan' : 'Build your plan', style: theme.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    Text(
                      _isRebuilding
                          ? "Adjust your preferences and we'll generate a fresh set of session templates."
                          : "Answer a few questions and we'll generate a training plan tailored to you.",
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ]),
                  const SizedBox(height: 24),
                  Card(
                    margin: EdgeInsets.zero,
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          section("What's your goal?", cards(_goals, _goal, (v) => setState(() => _goal = v))),
                          section('Training experience', cards(_experienceOptions, _experience, (v) => setState(() => _experience = v))),
                          section(
                            'Days per week',
                            Wrap(spacing: 8, children: [
                              for (final n in [2, 3, 4, 5, 6])
                                _DayButton(n: n, selected: _days == n, onTap: () => setState(() => _days = n)),
                            ]),
                          ),
                          section('Equipment', cards(_equipment, _equip, (v) => setState(() => _equip = v), columns: 2)),
                          section(
                            'Body focus (optional — select all that apply)',
                            Wrap(spacing: 8, runSpacing: 8, children: [
                              for (final o in _bodyFocus)
                                FilterChip(
                                  label: Text(o.label),
                                  selected: _focus.contains(o.value),
                                  onSelected: (v) => setState(() => v ? _focus.add(o.value) : _focus.remove(o.value)),
                                ),
                            ]),
                          ),
                          section(
                            'Session duration',
                            Row(children: [
                              for (final o in _durations)
                                Expanded(
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(horizontal: 3),
                                    child: _OptionCard(label: o.label, selected: _duration == o.value, center: true, onTap: () => setState(() => _duration = o.value)),
                                  ),
                                ),
                            ]),
                          ),
                          if (_error != null)
                            Container(
                              margin: const EdgeInsets.only(bottom: 12),
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: scheme.errorContainer.withValues(alpha: 0.4),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: scheme.error.withValues(alpha: 0.4)),
                              ),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(_error!, style: theme.textTheme.bodySmall?.copyWith(color: scheme.error)),
                                if (_errorOffersUpgrade)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 6),
                                    child: Text(services.purchases != null ? 'Pro lifts this limit. You can upgrade in Settings.' : 'Pro lifts this limit. You can upgrade in the Daily Grind web app.', style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
                                  ),
                              ]),
                            ),
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton.icon(
                              onPressed: _canGenerate && !_generating ? _generate : null,
                              icon: _generating
                                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                                  : const Icon(Icons.auto_awesome, size: 18),
                              label: _generating ? const _GeneratingText() : const Text('Generate my plan'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: _generating ? null : services.skipOnboarding,
                    child: Text(_isRebuilding ? 'Cancel — keep my current plan' : "Skip — I'll set up my plan manually"),
                  ),
                  if (!_isRebuilding)
                    Text(
                      'Skipping leaves you with the built-in sessions. You can build templates in Settings → Session Templates or generate a plan any time from Settings.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodySmall?.copyWith(color: scheme.outline),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _OptionCard extends StatelessWidget {
  const _OptionCard({required this.label, required this.selected, required this.onTap, this.sub, this.center = false});

  final String label;
  final String? sub;
  final bool selected;
  final bool center;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Semantics(
      inMutuallyExclusiveGroup: true,
      checked: selected,
      button: true,
      label: [label, ?sub].join('. '),
      child: ExcludeSemantics(
        child: Material(
          color: selected ? scheme.primaryContainer : Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: BorderSide(color: selected ? scheme.primary : scheme.outlineVariant, width: selected ? 1.5 : 1),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Column(
                crossAxisAlignment: center ? CrossAxisAlignment.center : CrossAxisAlignment.start,
                children: [
                  Text(label, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600, color: selected ? scheme.onPrimaryContainer : null)),
                  if (sub != null) Text(sub!, style: theme.textTheme.bodySmall?.copyWith(color: selected ? scheme.onPrimaryContainer : scheme.outline)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DayButton extends StatelessWidget {
  const _DayButton({required this.n, required this.selected, required this.onTap});

  final int n;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      inMutuallyExclusiveGroup: true,
      checked: selected,
      button: true,
      label: '$n days',
      child: ExcludeSemantics(
        child: Material(
          color: selected ? scheme.primaryContainer : Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(color: selected ? scheme.primary : scheme.outlineVariant, width: selected ? 1.5 : 1),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: onTap,
            child: SizedBox(
              width: 46,
              height: 46,
              child: Center(child: Text('$n', style: TextStyle(fontWeight: FontWeight.w700, color: selected ? scheme.onPrimaryContainer : null))),
            ),
          ),
        ),
      ),
    );
  }
}

/// "Analysing your goals..." and so on, changing every couple of seconds while the plan is being generated.
class _GeneratingText extends StatefulWidget {
  const _GeneratingText();

  @override
  State<_GeneratingText> createState() => _GeneratingTextState();
}

class _GeneratingTextState extends State<_GeneratingText> {
  int _step = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(milliseconds: 2200), (_) => setState(() => _step = (_step + 1) % _generatingSteps.length));
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Text(_generatingSteps[_step]);
}
