import 'dart:convert';

import 'package:flutter/material.dart';

import '../../domain/defaults.dart';
import '../../domain/exercise_library.dart';
import '../../domain/session_types.dart';
import '../../domain/templates.dart';
import '../../domain/video_url.dart';
import '../../domain/workout_transitions.dart';
import '../app_scope.dart';
import '../feedback.dart';

/// One exercise row being edited: its text fields live here until the section is saved.
class _RowDraft {
  _RowDraft(TemplateRow row, String fallbackId)
      : id = row.id ?? fallbackId,
        text = TextEditingController(text: row.text),
        target = TextEditingController(text: row.target ?? ''),
        equipment = TextEditingController(text: row.equipment ?? ''),
        description = TextEditingController(text: row.description ?? ''),
        videoUrl = TextEditingController(text: row.videoUrl ?? ''),
        textFocus = FocusNode();

  final String id;
  final TextEditingController text;
  final TextEditingController target;
  final TextEditingController equipment;
  final TextEditingController description;
  final TextEditingController videoUrl;
  final FocusNode textFocus;
  bool urlOpen = false;
  bool detailOpen = false;

  TemplateRow toRow() => TemplateRow(
        id: id,
        text: text.text,
        target: target.text,
        equipment: equipment.text.isEmpty ? null : equipment.text,
        description: description.text.isEmpty ? null : description.text,
        videoUrl: videoUrl.text.isEmpty ? null : videoUrl.text,
      );

  void dispose() {
    for (final c in [text, target, equipment, description, videoUrl]) {
      c.dispose();
    }
    textFocus.dispose();
  }
}

/// Edit the exercises of every session (the web app's "Session Templates" card): pick a session, a section (warm-up or main),
/// change, add, remove and reorder rows, then save. Sessions can be created, renamed and deleted here too.
class TemplateEditor extends StatefulWidget {
  const TemplateEditor({super.key});

  @override
  State<TemplateEditor> createState() => _TemplateEditorState();
}

class _TemplateEditorState extends State<TemplateEditor> {
  String? _session;
  WorkoutSection _section = WorkoutSection.main;
  var _drafts = <_RowDraft>[];
  String _loadedKey = '';
  Map<int, String> _errors = {};
  String? _firstError;

  bool _creating = false;
  bool _renaming = false;
  bool _submitting = false;
  final _newLabel = TextEditingController();
  final _renameLabel = TextEditingController();
  final _sessionVideo = TextEditingController();
  final _videoFocus = FocusNode();
  String _loadedVideo = '';
  String? _lastSaveError;

  @override
  void initState() {
    super.initState();
    _videoFocus.addListener(() {
      if (!_videoFocus.hasFocus) _saveVideo();
    });
  }

  @override
  void dispose() {
    for (final d in _drafts) {
      d.dispose();
    }
    _newLabel.dispose();
    _renameLabel.dispose();
    _sessionVideo.dispose();
    _videoFocus.dispose();
    super.dispose();
  }

  String _newId() => AppScope.of(context).workspace.idGen();

  static String workspaceLabel(dynamic services, String session) {
    final options = services.workspace.allSessionOptions as List<SessionOption>;
    return options.where((o) => o.value == session).firstOrNull?.label ?? getSessionLabel(session);
  }

  /// Reloads the editable rows when the stored section changed (first show, another session or section, a save, or a sync).
  void _syncWithStorage(Templates templates, String session) {
    final t = templates[session];
    final rows = t == null ? const <TemplateRow>[] : (_section == WorkoutSection.warmup ? t.warmup : t.main);
    final key = jsonEncode([session, _section.name, for (final r in rows) r.toJson()]);
    if (key != _loadedKey) {
      _loadedKey = key;
      for (final d in _drafts) {
        d.dispose();
      }
      _drafts = [for (final r in rows) _RowDraft(r, _newId())];
      _errors = {};
      _firstError = null;
    }
    final video = t?.videoUrl ?? '';
    if (video != _loadedVideo) {
      _loadedVideo = video;
      if (!_videoFocus.hasFocus) _sessionVideo.text = video;
    }
  }

  Future<void> _saveSection() async {
    final workspace = AppScope.of(context).workspace;
    final session = _session!;
    final errors = await workspace.saveSection(session, _section, [for (final d in _drafts) d.toRow()]);
    if (!mounted) return;
    setState(() {
      _errors = {for (final e in errors) e.rowIndex: e.message};
      _firstError = errors.isEmpty ? null : errors.first.message;
    });
    if (errors.isNotEmpty) {
      showToast(context, errors.first.message, tone: ToastTone.error);
    } else {
      showToast(context, 'Template saved', tone: ToastTone.success);
    }
  }

  void _saveVideo() {
    final session = _session;
    if (session == null) return;
    final trimmed = _sessionVideo.text.trim();
    if (trimmed == _loadedVideo) return;
    AppScope.of(context).workspace.saveVideoUrl(session, trimmed.isEmpty ? null : trimmed);
  }

  Future<void> _create() async {
    final label = _newLabel.text.trim();
    if (_submitting || label.isEmpty) return;
    setState(() => _submitting = true);
    final result = await AppScope.of(context).workspace.addSessionType(label);
    if (!mounted) return;
    setState(() => _submitting = false);
    if (result.ok) {
      showToast(context, result.message, tone: ToastTone.success);
      setState(() {
        _session = result.sessionType;
        _newLabel.clear();
        _creating = false;
      });
    } else {
      showToast(context, result.message, tone: ToastTone.error);
    }
  }

  Future<void> _rename() async {
    final label = _renameLabel.text.trim();
    if (label.isEmpty) return;
    final result = await AppScope.of(context).workspace.renameSession(_session!, label);
    if (!mounted) return;
    if (result.ok) {
      showToast(context, result.message, tone: ToastTone.success);
      setState(() {
        _renaming = false;
        _renameLabel.clear();
      });
    } else {
      showToast(context, result.message, tone: ToastTone.error);
    }
  }

  Future<void> _delete() async {
    final services = AppScope.of(context);
    final session = _session!;
    // The name shown in the picker (the web app uses the id-derived one, which can differ from what the user sees).
    final label = workspaceLabel(services, session);
    final inUse = services.tracker.usedSessionTypes.contains(session);
    final confirmed = await confirmDialog(
      context,
      title: inUse ? '"$label" is used in your workout history' : 'Delete "$label"?',
      description: inUse
          ? 'Those days will keep their data but their session label will show as unknown. Delete anyway?'
          : 'This removes the session type and its template. Existing workout days are not affected.',
      confirmLabel: 'Delete',
      danger: true,
    );
    if (!confirmed || !mounted) return;
    final result = await services.workspace.removeSessionType(session);
    if (!mounted) return;
    showToast(context, result.message, tone: result.ok ? ToastTone.success : ToastTone.error);
  }

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    final workspace = services.workspace;
    return ListenableBuilder(
      listenable: workspace,
      builder: (context, _) {
        final options = workspace.allSessionOptions;
        if (options.isEmpty) {
          return const _EditorCard(child: Text('No sessions yet.'));
        }
        if (_session == null || !options.any((o) => o.value == _session)) _session = options.first.value;
        final session = _session!;
        _syncWithStorage(workspace.templates, session);

        final theme = Theme.of(context);
        final scheme = theme.colorScheme;
        final current = options.firstWhere((o) => o.value == session);
        final library = buildExerciseLibrary(services.tracker.allData);
        final saveError = workspace.lastTemplateError;
        if (saveError != null && saveError != _lastSaveError) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) showToast(context, 'Template save failed', description: saveError, tone: ToastTone.error);
          });
        }
        _lastSaveError = saveError;
        final videoText = _sessionVideo.text.trim();
        final videoBad = videoText.isNotEmpty && !isValidYouTubeUrl(videoText);

        return _EditorCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_renaming)
                Row(children: [
                  Expanded(
                    child: TextField(
                      controller: _renameLabel,
                      autofocus: true,
                      maxLength: 50,
                      decoration: const InputDecoration(hintText: 'Session name', counterText: '', border: OutlineInputBorder()),
                      onSubmitted: (_) => _rename(),
                    ),
                  ),
                  IconButton(tooltip: 'Confirm rename', icon: const Icon(Icons.check), onPressed: _rename),
                  IconButton(tooltip: 'Cancel', icon: const Icon(Icons.close), onPressed: () => setState(() => _renaming = false)),
                ])
              else
                Row(children: [
                  Expanded(child: _SessionDropdown(options: options, selected: session, onChanged: (v) => setState(() {
                        _session = v;
                        _creating = false;
                      }))),
                  IconButton(
                    tooltip: 'Rename session type',
                    icon: const Icon(Icons.edit_outlined, size: 20),
                    onPressed: () => setState(() {
                      _renaming = true;
                      _renameLabel.text = current.label;
                    }),
                  ),
                  IconButton(tooltip: 'Delete session type', icon: const Icon(Icons.delete_outline, size: 20), onPressed: _delete),
                  IconButton.outlined(
                    tooltip: 'Add new session type',
                    icon: Icon(_creating ? Icons.close : Icons.add, size: 20),
                    onPressed: () => setState(() => _creating = !_creating),
                  ),
                ]),
              if (!_renaming && current.source != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: _Badge(label: current.source == 'ai' ? 'AI Generated' : 'User Created', accent: current.source == 'ai'),
                  ),
                ),
              if (!_renaming) ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _sessionVideo,
                  focusNode: _videoFocus,
                  keyboardType: TextInputType.url,
                  decoration: InputDecoration(
                    labelText: 'Session video URL',
                    hintText: 'https://youtube.com/watch?v=...',
                    errorText: videoBad ? 'Must be a valid YouTube URL' : null,
                    prefixIcon: const Icon(Icons.smart_display_outlined, size: 18),
                    border: const OutlineInputBorder(),
                  ),
                  onChanged: (_) => setState(() {}),
                  onSubmitted: (_) => _saveVideo(),
                ),
              ],
              if (_creating && !_renaming) ...[
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(
                    child: TextField(
                      controller: _newLabel,
                      autofocus: true,
                      maxLength: 50,
                      decoration: const InputDecoration(hintText: 'e.g. Morning Yoga', counterText: '', border: OutlineInputBorder()),
                      onChanged: (_) => setState(() {}),
                      onSubmitted: (_) => _create(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(onPressed: _submitting || _newLabel.text.trim().isEmpty ? null : _create, child: const Text('Create')),
                  TextButton(onPressed: () => setState(() => _creating = false), child: const Text('Cancel')),
                ]),
              ],
              const SizedBox(height: 16),
              Wrap(
                alignment: WrapAlignment.spaceBetween,
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 8,
                runSpacing: 4,
                children: [
                  SegmentedButton<WorkoutSection>(
                    showSelectedIcon: false,
                    segments: const [
                      ButtonSegment(value: WorkoutSection.warmup, label: Text('Warm-up')),
                      ButtonSegment(value: WorkoutSection.main, label: Text('Main')),
                    ],
                    selected: {_section},
                    onSelectionChanged: (s) => setState(() => _section = s.first),
                  ),
                  Row(mainAxisSize: MainAxisSize.min, children: [
                    TextButton.icon(
                      icon: const Icon(Icons.undo, size: 16),
                      label: const Text('Undo'),
                      onPressed: () async {
                        final undone = await workspace.undoSection(session, _section);
                        if (context.mounted) showToast(context, undone ? 'Last change undone' : 'Nothing to undo');
                      },
                    ),
                    TextButton.icon(
                      icon: const Icon(Icons.restart_alt, size: 16),
                      label: const Text('Reset'),
                      onPressed: () async {
                        await workspace.resetSection(session, _section);
                        if (context.mounted) showToast(context, 'Section reset to defaults');
                      },
                    ),
                  ]),
                ],
              ),
              if (_firstError != null)
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(top: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: scheme.errorContainer.withValues(alpha: 0.4),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: scheme.error.withValues(alpha: 0.4)),
                  ),
                  child: Text(_firstError!, style: theme.textTheme.bodySmall?.copyWith(color: scheme.error)),
                ),
              const SizedBox(height: 8),
              if (_drafts.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Text('No exercises in this section yet.', style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant)),
                )
              else
                ReorderableListView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  buildDefaultDragHandles: false,
                  itemCount: _drafts.length,
                  onReorderItem: (from, to) => setState(() {
                    _drafts.insert(to, _drafts.removeAt(from));
                    _errors = {};
                  }),
                  itemBuilder: (context, i) {
                    final d = _drafts[i];
                    return Padding(
                      key: ValueKey('row-${d.id}'),
                      padding: const EdgeInsets.only(bottom: 14),
                      child: _RowEditor(
                        index: i,
                        draft: d,
                        library: library,
                        error: _errors[i],
                        onChanged: () => setState(() {}),
                        onRemove: () => setState(() {
                          _drafts.removeAt(i).dispose();
                          _errors = {};
                        }),
                      ),
                    );
                  },
                ),
              const Divider(),
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                TextButton.icon(
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('Add Exercise'),
                  onPressed: () => setState(() => _drafts.add(_RowDraft(TemplateRow(id: _newId(), text: '', target: ''), _newId()))),
                ),
                FilledButton.icon(icon: const Icon(Icons.save_outlined, size: 16), label: const Text('Save'), onPressed: _saveSection),
              ]),
            ],
          ),
        );
      },
    );
  }
}

class _EditorCard extends StatelessWidget {
  const _EditorCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Session Templates', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              child,
            ],
          ),
        ),
      );
}

class _Badge extends StatelessWidget {
  const _Badge({required this.label, required this.accent});

  final String label;
  final bool accent;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = accent ? scheme.primary : scheme.onSurfaceVariant;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        border: Border.all(color: color.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(label, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: color)),
    );
  }
}

class _SessionDropdown extends StatelessWidget {
  const _SessionDropdown({required this.options, required this.selected, required this.onChanged});

  final List<SessionOption> options;
  final String selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final mine = [for (final o in options) if (o.source != 'ai') o];
    final ai = [for (final o in options) if (o.source == 'ai') o];
    DropdownMenuItem<String> item(SessionOption o, {bool tag = false}) =>
        DropdownMenuItem(value: o.value, child: Text(tag ? '${o.label} [AI]' : o.label, overflow: TextOverflow.ellipsis));
    DropdownMenuItem<String> heading(String t) => DropdownMenuItem(
          enabled: false,
          value: '__heading_$t',
          child: Text(t.toUpperCase(), style: Theme.of(context).textTheme.labelSmall?.copyWith(letterSpacing: 1.2)),
        );
    final items = ai.isEmpty
        ? [for (final o in options) item(o)]
        : [
            if (mine.isNotEmpty) ...[heading('My sessions'), for (final o in mine) item(o)],
            heading('AI generated'),
            for (final o in ai) item(o, tag: true),
          ];
    return DropdownButtonFormField<String>(
      key: ValueKey('editor-session-$selected-${options.length}'),
      initialValue: selected,
      isExpanded: true,
      decoration: const InputDecoration(border: OutlineInputBorder(), contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8)),
      items: items,
      onChanged: (v) {
        if (v != null && !v.startsWith('__heading_')) onChanged(v);
      },
    );
  }
}

class _RowEditor extends StatefulWidget {
  const _RowEditor({
    required this.index,
    required this.draft,
    required this.library,
    required this.error,
    required this.onChanged,
    required this.onRemove,
  });

  final int index;
  final _RowDraft draft;
  final List<ExerciseLibraryEntry> library;
  final String? error;
  final VoidCallback onChanged;
  final VoidCallback onRemove;

  @override
  State<_RowEditor> createState() => _RowEditorState();
}

class _RowEditorState extends State<_RowEditor> {
  @override
  Widget build(BuildContext context) {
    final d = widget.draft;
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final url = d.videoUrl.text.trim();
    final urlBad = url.isNotEmpty && !isValidYouTubeUrl(url);
    final showUrl = d.urlOpen || d.videoUrl.text.isNotEmpty;
    final showDetail = d.detailOpen || d.equipment.text.isNotEmpty || d.description.text.isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ReorderableDragStartListener(
              index: widget.index,
              child: Padding(
                padding: const EdgeInsets.only(top: 14, right: 8),
                child: Icon(Icons.drag_indicator, color: scheme.onSurfaceVariant, semanticLabel: 'Reorder row'),
              ),
            ),
            Expanded(
              child: Column(children: [
                RawAutocomplete<ExerciseLibraryEntry>(
                  textEditingController: d.text,
                  focusNode: d.textFocus,
                  displayStringForOption: (e) => e.text,
                  optionsBuilder: (value) => suggestExercises(value.text, widget.library),
                  onSelected: (entry) {
                    if (entry.target != null) d.target.text = entry.target!;
                    widget.onChanged();
                  },
                  fieldViewBuilder: (context, controller, focus, onSubmit) => TextField(
                    controller: controller,
                    focusNode: focus,
                    maxLength: templateTextMaxLength,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: InputDecoration(
                      hintText: 'Exercise',
                      counterText: '',
                      errorText: widget.error,
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  optionsViewBuilder: (context, onSelected, options) => Align(
                    alignment: Alignment.topLeft,
                    child: Material(
                      elevation: 4,
                      borderRadius: BorderRadius.circular(12),
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxHeight: 208, maxWidth: 360),
                        child: ListView(
                          padding: EdgeInsets.zero,
                          shrinkWrap: true,
                          children: [
                            for (final o in options)
                              ListTile(
                                dense: true,
                                title: Text(o.text, overflow: TextOverflow.ellipsis),
                                trailing: o.target == null ? null : Text(o.target!, style: theme.textTheme.bodySmall),
                                onTap: () => onSelected(o),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: d.target,
                  maxLength: templateTargetMaxLength,
                  decoration: const InputDecoration(hintText: 'Target (e.g. 3x8-12)', counterText: '', border: OutlineInputBorder(), isDense: true),
                ),
              ]),
            ),
            IconButton(tooltip: 'Remove row', icon: const Icon(Icons.delete_outline, size: 20), onPressed: widget.onRemove),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(left: 32),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (showUrl)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: TextField(
                  controller: d.videoUrl,
                  keyboardType: TextInputType.url,
                  decoration: InputDecoration(
                    hintText: 'YouTube URL (optional)',
                    errorText: urlBad ? 'Must be a valid YouTube URL' : null,
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  onChanged: (_) => setState(() {}),
                ),
              )
            else
              TextButton.icon(
                style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                icon: const Icon(Icons.link, size: 14),
                label: const Text('Add YT Link'),
                onPressed: () => setState(() => d.urlOpen = true),
              ),
            if (showDetail) ...[
              const SizedBox(height: 8),
              TextField(
                controller: d.equipment,
                maxLength: 50,
                decoration: const InputDecoration(hintText: 'Equipment (e.g. Barbell + squat rack)', counterText: '', border: OutlineInputBorder(), isDense: true),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: d.description,
                maxLength: 200,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(
                  hintText: 'How to perform (e.g. Feet shoulder-width apart, descend until thighs parallel)',
                  counterText: '',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
            ] else
              TextButton.icon(
                style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                icon: const Icon(Icons.info_outline, size: 14),
                label: const Text('Add equipment & description'),
                onPressed: () => setState(() => d.detailOpen = true),
              ),
          ]),
        ),
      ],
    );
  }
}
