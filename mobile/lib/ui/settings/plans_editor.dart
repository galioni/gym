import 'package:flutter/material.dart';

import '../../domain/session_types.dart';
import '../../domain/templates.dart';
import '../../domain/week_plan.dart';
import '../app_scope.dart';
import '../feedback.dart';

const _dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/// Group sessions into named plans, optionally giving each weekday a session, and choose which plan is active (the web app's
/// "Plans" card). The active plan filters the day screen's session picker and drives its week bar.
class PlansEditor extends StatefulWidget {
  const PlansEditor({super.key});

  @override
  State<PlansEditor> createState() => _PlansEditorState();
}

class _PlansEditorState extends State<PlansEditor> {
  bool _creating = false;

  @override
  Widget build(BuildContext context) {
    final workspace = AppScope.of(context).workspace;
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    return ListenableBuilder(
      listenable: workspace,
      builder: (context, _) {
        final options = workspace.allSessionOptions;
        return Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Plans', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                Text(
                  'Group sessions into named plans. Activate a plan to filter the session picker on the day screen. Sessions are shared — the same session can belong to multiple plans.',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
                ),
                const SizedBox(height: 12),
                if (workspace.plans.isEmpty && !_creating)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      'No plans yet. A plan groups a set of sessions (e.g. "Strength block: Push, Pull, Legs"). When you activate a plan, the session picker only shows its sessions.',
                      style: theme.textTheme.bodySmall?.copyWith(color: muted),
                    ),
                  ),
                for (final plan in workspace.plans)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: _PlanRow(key: ValueKey('plan-${plan.id}'), plan: plan, options: options, isActive: plan.id == workspace.activePlanId),
                  ),
                if (_creating)
                  _PlanForm(
                    options: options,
                    submitLabel: 'Create',
                    onCancel: () => setState(() => _creating = false),
                    onSubmit: (label, sessions, schedule) async {
                      await workspace.createPlan(label, sessions, schedule: schedule);
                      if (mounted) setState(() => _creating = false);
                    },
                  )
                else
                  FilledButton.tonalIcon(
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('New plan'),
                    onPressed: () => setState(() => _creating = true),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _PlanRow extends StatefulWidget {
  const _PlanRow({super.key, required this.plan, required this.options, required this.isActive});

  final Plan plan;
  final List<SessionOption> options;
  final bool isActive;

  @override
  State<_PlanRow> createState() => _PlanRowState();
}

class _PlanRowState extends State<_PlanRow> {
  bool _editing = false;

  String _labelFor(String id) => widget.options.where((o) => o.value == id).firstOrNull?.label ?? id;

  @override
  Widget build(BuildContext context) {
    final workspace = AppScope.of(context).workspace;
    final plan = widget.plan;
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    if (_editing) {
      return _PlanForm(
        options: widget.options,
        initial: plan,
        submitLabel: 'Save',
        onCancel: () => setState(() => _editing = false),
        onSubmit: (label, sessions, schedule) async {
          await workspace.updatePlan(plan.id, label: label, sessionIds: sessions, schedule: schedule);
          if (mounted) setState(() => _editing = false);
        },
      );
    }

    final schedule = plan.schedule;
    final hasSchedule = schedule != null && schedule.isNotEmpty;
    final summary = hasSchedule
        ? (schedule.entries.toList()..sort((a, b) => int.parse(a.key).compareTo(int.parse(b.key))))
            .map((e) => '${dayAbbreviations[int.parse(e.key)]}: ${_labelFor(e.value)}')
            .join(' · ')
        : plan.sessionIds.isEmpty
            ? 'No sessions'
            : plan.sessionIds.map(_labelFor).join(', ');

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        color: widget.isActive ? scheme.primaryContainer.withValues(alpha: 0.3) : null,
        border: Border.all(color: widget.isActive ? scheme.primary.withValues(alpha: 0.4) : scheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Flexible(child: Text(plan.label, style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis)),
            if (widget.isActive) ...[
              const SizedBox(width: 8),
              Tooltip(
                message: 'This plan is active — the session picker only shows its sessions',
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(border: Border.all(color: scheme.primary.withValues(alpha: 0.5)), borderRadius: BorderRadius.circular(6)),
                  child: Text('ACTIVE', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: scheme.primary)),
                ),
              ),
            ],
            if (hasSchedule) ...[
              const SizedBox(width: 6),
              Icon(Icons.calendar_month, size: 14, color: scheme.outline, semanticLabel: 'Has a weekly schedule'),
            ],
          ]),
          const SizedBox(height: 2),
          Text(summary, style: theme.textTheme.bodySmall?.copyWith(color: scheme.outline)),
          const SizedBox(height: 4),
          Wrap(spacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
            FilledButton.tonal(
              style: FilledButton.styleFrom(visualDensity: VisualDensity.compact),
              onPressed: () => workspace.setActivePlan(widget.isActive ? null : plan.id),
              child: Text(widget.isActive ? 'Deactivate' : 'Set active'),
            ),
            IconButton(tooltip: 'Edit plan', icon: const Icon(Icons.edit_outlined, size: 18), onPressed: () => setState(() => _editing = true)),
            IconButton(
              tooltip: 'Delete plan',
              icon: const Icon(Icons.delete_outline, size: 18),
              onPressed: () async {
                final go = await confirmDialog(
                  context,
                  title: 'Delete "${plan.label}"?',
                  description: 'The plan is removed. Its sessions and your workout history are not affected.',
                  confirmLabel: 'Delete',
                  danger: true,
                );
                if (go) await workspace.deletePlan(plan.id);
              },
            ),
          ]),
        ],
      ),
    );
  }
}

/// Create or edit a plan: a name, which sessions it holds, and optionally which session falls on which weekday.
class _PlanForm extends StatefulWidget {
  const _PlanForm({required this.options, required this.submitLabel, required this.onCancel, required this.onSubmit, this.initial});

  final List<SessionOption> options;
  final Plan? initial;
  final String submitLabel;
  final VoidCallback onCancel;
  final Future<void> Function(String label, List<String> sessions, Map<String, String>? schedule) onSubmit;

  @override
  State<_PlanForm> createState() => _PlanFormState();
}

class _PlanFormState extends State<_PlanForm> {
  late final TextEditingController _label = TextEditingController(text: widget.initial?.label ?? '');
  late final List<String> _sessions = List.of(widget.initial?.sessionIds ?? const []);
  late bool _scheduleOn = widget.initial?.schedule?.isNotEmpty ?? false;
  late final Map<String, String> _schedule = Map.of(widget.initial?.schedule ?? const {});
  bool _saving = false;

  @override
  void dispose() {
    _label.dispose();
    super.dispose();
  }

  void _toggle(String id) {
    setState(() {
      if (_sessions.contains(id)) {
        _sessions.remove(id);
        // A day cannot keep a session the plan no longer includes.
        _schedule.removeWhere((_, session) => session == id);
      } else {
        _sessions.add(id);
      }
    });
  }

  Future<void> _submit() async {
    final label = _label.text.trim();
    if (label.isEmpty || _saving) return;
    setState(() => _saving = true);
    await widget.onSubmit(label, _sessions, _scheduleOn && _schedule.isNotEmpty ? _schedule : null);
    if (mounted) setState(() => _saving = false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final label = theme.textTheme.labelSmall?.copyWith(letterSpacing: 1.2, fontWeight: FontWeight.w700, color: scheme.outline);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        color: scheme.primaryContainer.withValues(alpha: 0.15),
        border: Border.all(color: scheme.primary.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _label,
            autofocus: true,
            maxLength: 40,
            decoration: const InputDecoration(hintText: 'Plan name (e.g. Strength block)', counterText: '', border: OutlineInputBorder()),
            onChanged: (_) => setState(() {}),
            onSubmitted: (_) => _submit(),
          ),
          const SizedBox(height: 12),
          Text(widget.initial == null ? 'SESSIONS IN THIS PLAN' : 'SESSIONS', style: label),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final o in widget.options)
              FilterChip(label: Text(o.label), selected: _sessions.contains(o.value), onSelected: (_) => _toggle(o.value)),
          ]),
          const SizedBox(height: 12),
          FilterChip(
            avatar: const Icon(Icons.calendar_month, size: 14),
            label: const Text('Assign sessions to days'),
            selected: _scheduleOn,
            onSelected: (v) => setState(() => _scheduleOn = v),
          ),
          if (_scheduleOn) ...[
            const SizedBox(height: 12),
            Text('DAY SCHEDULE', style: label),
            const SizedBox(height: 8),
            for (var day = 0; day < 7; day++)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(children: [
                  SizedBox(width: 96, child: Text(_dayNames[day], style: theme.textTheme.bodySmall)),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      key: ValueKey('day-$day-${_schedule['$day']}-${_sessions.length}'),
                      initialValue: _schedule['$day'] ?? '',
                      isExpanded: true,
                      isDense: true,
                      decoration: const InputDecoration(border: OutlineInputBorder(), contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8)),
                      items: [
                        const DropdownMenuItem(value: '', child: Text('—')),
                        for (final id in _sessions)
                          DropdownMenuItem(
                            value: id,
                            child: Text(widget.options.where((o) => o.value == id).firstOrNull?.label ?? id, overflow: TextOverflow.ellipsis),
                          ),
                      ],
                      onChanged: (v) => setState(() {
                        if (v == null || v.isEmpty) {
                          _schedule.remove('$day');
                        } else {
                          _schedule['$day'] = v;
                        }
                      }),
                    ),
                  ),
                ]),
              ),
          ],
          const SizedBox(height: 12),
          Row(children: [
            FilledButton.icon(
              icon: const Icon(Icons.check, size: 16),
              label: Text(widget.submitLabel),
              onPressed: _label.text.trim().isEmpty || _saving ? null : _submit,
            ),
            const SizedBox(width: 8),
            TextButton.icon(icon: const Icon(Icons.close, size: 16), label: const Text('Cancel'), onPressed: widget.onCancel),
          ]),
        ],
      ),
    );
  }
}
