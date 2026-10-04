/// Session types: labels, the option list the pickers show, and creating, renaming and deleting them. Port of
/// `application/workout/sessionTypes/sessionTypeRules.ts`; wording and ordering are pinned by
/// contract/dashboard.fixtures.json.
library;

import 'defaults.dart';
import 'locale_compare.dart';
import 'models.dart';
import 'templates.dart';

class SessionOption {
  const SessionOption({required this.value, required this.label, this.focus, this.source});

  final String value;
  final String label;
  final String? focus;

  /// `ai` or `user`.
  final String? source;

  Json toJson() => {
        'value': value,
        'label': label,
        if (focus != null) 'focus': focus,
        if (source != null) 'source': source,
      };
}

/// The built-in sessions, in the order they are listed.
const _builtInLabels = {
  'tennis': 'Tennis day (warm-up + strength mini)',
  'gym': 'Gym day (full session)',
  'swim': 'Swim day (short warm-up)',
  'rest': 'Rest / Recovery',
};

const _sessionTypeIdMaxLength = 32;

bool isBuiltInSessionType(String sessionType) => _builtInLabels.containsKey(sessionType);

TemplateData getDefaultTemplate(String sessionType) => defaultTemplates[sessionType] ?? emptyTemplate;

final _separators = RegExp(r'[-_\s]+');

String getSessionLabel(String sessionType) {
  final builtIn = _builtInLabels[sessionType];
  if (builtIn != null) return builtIn;
  return sessionType
      .split(_separators)
      .where((p) => p.isNotEmpty)
      .map((p) => p.substring(0, 1).toUpperCase() + p.substring(1))
      .join(' ');
}

List<SessionOption> getSessionOptions(Templates templates) {
  SessionOption toOption(String type) => SessionOption(
        value: type,
        label: templates[type]?.label ?? getSessionLabel(type),
        focus: templates[type]?.focus,
        source: templates[type]?.source,
      );
  final builtIns = [for (final v in _builtInLabels.keys) if (templates.containsKey(v)) toOption(v)];
  final customTypes = [for (final k in templates.keys) if (!isBuiltInSessionType(k)) k];
  // Dart's sort is not stable, JavaScript's is: equal labels keep their original order.
  final custom = [for (var i = 0; i < customTypes.length; i++) (i, toOption(customTypes[i]))]..sort((a, b) {
      final c = localeCompare(a.$2.label, b.$2.label);
      return c != 0 ? c : a.$1.compareTo(b.$1);
    });
  return [...builtIns, for (final c in custom) c.$2];
}

final _notIdChars = RegExp(r'[^a-z0-9]+');
final _edgeDashes = RegExp(r'^-+|-+$');

/// A lowercase, dash-separated id from what the user typed; null when nothing usable is left.
String? normalizeSessionTypeId(String value) {
  var normalized = value.trim().toLowerCase().replaceAll(_notIdChars, '-').replaceAll(_edgeDashes, '');
  if (normalized.length > _sessionTypeIdMaxLength) normalized = normalized.substring(0, _sessionTypeIdMaxLength);
  return normalized.isNotEmpty ? normalized : null;
}

enum RuleStatus { success, error }

class SessionTypeResult {
  const SessionTypeResult(
    this.status,
    this.message, {
    this.sessionType,
    this.oldSessionType,
    this.newSessionType,
    this.templates,
  });

  final RuleStatus status;
  final String message;

  /// The id that was created (create).
  final String? sessionType;

  /// For a rename: the ids before and after. Renaming changes the label only, so they are equal.
  final String? oldSessionType;
  final String? newSessionType;
  final Templates? templates;

  bool get ok => status == RuleStatus.success;
}

SessionTypeResult createSessionType(Templates templates, String label) {
  final sessionType = normalizeSessionTypeId(label);
  if (sessionType == null) {
    return const SessionTypeResult(RuleStatus.error, 'Enter a session type name using letters or numbers.');
  }
  if (templates.containsKey(sessionType)) {
    return SessionTypeResult(RuleStatus.error, 'Session type "${getSessionLabel(sessionType)}" already exists.');
  }
  final derivedLabel = getSessionLabel(sessionType);
  final existing = getSessionOptions(templates).map((o) => o.label.toLowerCase());
  if (existing.contains(derivedLabel.toLowerCase())) {
    return SessionTypeResult(RuleStatus.error, 'Session type "$derivedLabel" already exists.');
  }
  return SessionTypeResult(
    RuleStatus.success,
    'Session type "${getSessionLabel(sessionType)}" added.',
    sessionType: sessionType,
    templates: {...templates, sessionType: const TemplateData(source: 'user')},
  );
}

SessionTypeResult deleteSessionType(Templates templates, String sessionType) {
  if (!templates.containsKey(sessionType)) {
    return SessionTypeResult(RuleStatus.error, 'Session type "${getSessionLabel(sessionType)}" not found.');
  }
  return SessionTypeResult(
    RuleStatus.success,
    'Session type "${getSessionLabel(sessionType)}" deleted.',
    templates: {for (final e in templates.entries) if (e.key != sessionType) e.key: e.value},
  );
}

final _hasAlnum = RegExp(r'[a-zA-Z0-9]');

SessionTypeResult renameSessionType(Templates templates, String oldType, String newLabel) {
  final trimmed = newLabel.trim();
  if (trimmed.isEmpty || !_hasAlnum.hasMatch(trimmed)) {
    return const SessionTypeResult(RuleStatus.error, 'Enter a session type name using letters or numbers.');
  }
  final currentLabel = templates[oldType]?.label ?? getSessionLabel(oldType);
  if (trimmed.toLowerCase() == currentLabel.toLowerCase()) {
    return const SessionTypeResult(RuleStatus.error, 'New name is the same as the current name.');
  }
  final others = getSessionOptions(templates).where((o) => o.value != oldType).map((o) => o.label.toLowerCase());
  if (others.contains(trimmed.toLowerCase())) {
    return SessionTypeResult(RuleStatus.error, 'Session type "$trimmed" already exists.');
  }
  return SessionTypeResult(
    RuleStatus.success,
    'Session type renamed to "$trimmed".',
    oldSessionType: oldType,
    newSessionType: oldType,
    templates: {...templates, oldType: (templates[oldType] ?? emptyTemplate).withLabel(trimmed)},
  );
}
