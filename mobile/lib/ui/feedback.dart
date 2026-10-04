import 'package:flutter/material.dart';

enum ToastTone { success, info, error }

/// A short message at the bottom of the screen (the web app's toast). One at a time: a new one replaces the old.
void showToast(
  BuildContext context,
  String title, {
  String? description,
  ToastTone tone = ToastTone.info,
  String? actionLabel,
  VoidCallback? onAction,
  Duration? duration,
}) {
  final messenger = ScaffoldMessenger.maybeOf(context);
  if (messenger == null) return;
  final scheme = Theme.of(context).colorScheme;
  final background = switch (tone) {
    ToastTone.error => scheme.errorContainer,
    ToastTone.success => scheme.primaryContainer,
    ToastTone.info => scheme.inverseSurface,
  };
  final foreground = switch (tone) {
    ToastTone.error => scheme.onErrorContainer,
    ToastTone.success => scheme.onPrimaryContainer,
    ToastTone.info => scheme.onInverseSurface,
  };
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      backgroundColor: background,
      duration: duration ?? Duration(seconds: description == null ? 3 : 6),
      behavior: SnackBarBehavior.floating,
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: TextStyle(color: foreground, fontWeight: FontWeight.w600)),
          if (description != null) Text(description, style: TextStyle(color: foreground)),
        ],
      ),
      action: actionLabel == null || onAction == null
          ? null
          : SnackBarAction(label: actionLabel, textColor: foreground, onPressed: onAction),
    ));
}

/// Asks the user to confirm something. Completes with false if they cancel or tap outside.
Future<bool> confirmDialog(
  BuildContext context, {
  required String title,
  String? description,
  String confirmLabel = 'OK',
  String cancelLabel = 'Cancel',
  bool danger = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (context) {
      final scheme = Theme.of(context).colorScheme;
      return AlertDialog(
        title: Text(title),
        content: description == null ? null : Text(description),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text(cancelLabel)),
          FilledButton(
            style: danger ? FilledButton.styleFrom(backgroundColor: scheme.error, foregroundColor: scheme.onError) : null,
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(confirmLabel),
          ),
        ],
      );
    },
  );
  return result ?? false;
}
