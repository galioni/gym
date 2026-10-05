import 'package:flutter/foundation.dart' show ValueListenable;
import 'package:flutter/material.dart';

import '../../sync/sync_status.dart';

/// The sync state in the app bar: a small icon (and, when asked, its words) that opens Settings.
class SyncStatusChip extends StatelessWidget {
  const SyncStatusChip({super.key, required this.status, required this.onTap, this.showLabel = false});

  final SyncStatus status;
  final VoidCallback onTap;
  final bool showLabel;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (IconData icon, Color color) = switch (status.kind) {
      SyncStatusKind.attention => (Icons.error_outline, scheme.error),
      SyncStatusKind.offline => (Icons.cloud_off, scheme.tertiary),
      SyncStatusKind.syncing => (Icons.sync, scheme.primary),
      SyncStatusKind.synced => (Icons.cloud_done_outlined, scheme.primary),
      SyncStatusKind.idle => (Icons.cloud_queue, scheme.onSurfaceVariant),
    };
    return Semantics(
      button: true,
      label: '${status.label}. ${status.detail}',
      child: Tooltip(
        message: status.detail,
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              ExcludeSemantics(child: Icon(icon, size: 20, color: color)),
              if (showLabel) ...[
                const SizedBox(width: 6),
                ExcludeSemantics(child: Text(status.label, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600))),
              ],
            ]),
          ),
        ),
      ),
    );
  }
}

/// Shown across the top while the device has no connection.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key, required this.online});

  final ValueListenable<bool> online;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<bool>(
        valueListenable: online,
        builder: (context, isOnline, _) {
          if (isOnline) return const SizedBox.shrink();
          final scheme = Theme.of(context).colorScheme;
          return Semantics(
            liveRegion: true,
            child: Container(
              width: double.infinity,
              color: scheme.tertiaryContainer,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                Icon(Icons.wifi_off, size: 14, color: scheme.onTertiaryContainer),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(
                    "You're offline — changes will save locally and sync when you reconnect.",
                    style: TextStyle(color: scheme.onTertiaryContainer, fontSize: 12, fontWeight: FontWeight.w500),
                  ),
                ),
              ]),
            ),
          );
        },
      );
}
