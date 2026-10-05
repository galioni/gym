/// What a template row must satisfy before it can be saved, and the same limits the sanitiser enforces afterwards (port of
/// `validateTemplateRows` in `templateRules.ts`). Wording is pinned by contract/editors.fixtures.json.
library;

import 'defaults.dart';

class TemplateValidationError {
  const TemplateValidationError({required this.rowIndex, required this.field, required this.message});

  final int rowIndex;

  /// `text` or `target`.
  final String field;
  final String message;
}

/// One entry per problem, in row order. An empty list means the rows can be saved.
List<TemplateValidationError> validateTemplateRows(List<({String text, String? target})> rows) {
  final errors = <TemplateValidationError>[];
  for (var index = 0; index < rows.length; index++) {
    final text = rows[index].text.trim();
    final target = (rows[index].target ?? '').trim();
    if (text.isEmpty) {
      errors.add(TemplateValidationError(rowIndex: index, field: 'text', message: 'Exercise name is required.'));
    }
    if (text.length > templateTextMaxLength) {
      errors.add(TemplateValidationError(
        rowIndex: index,
        field: 'text',
        message: 'Exercise name must be <= $templateTextMaxLength characters.',
      ));
    }
    if (target.length > templateTargetMaxLength) {
      errors.add(TemplateValidationError(
        rowIndex: index,
        field: 'target',
        message: 'Target must be <= $templateTargetMaxLength characters.',
      ));
    }
  }
  return errors;
}
