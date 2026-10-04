import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api/api_client.dart';
import '../../api/plan_generation.dart';
import '../../app/app_services.dart';
import '../../billing/pro_purchases.dart';
import '../../billing/store_billing.dart';
import '../../api/subscription.dart';
import '../../auth/auth_controller.dart';
import '../../domain/plan_text.dart';
import '../../state/ai_settings.dart';
import '../../state/theme_controller.dart';
import '../app_scope.dart';
import '../feedback.dart';
import 'plans_editor.dart';
import 'sync_panel.dart';
import 'template_editor.dart';

/// Account, AI plan, session templates, plans, subscription, sync and data.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key, required this.auth, this.openUrl});

  final AuthController auth;

  /// Opens a link outside the app (store subscription settings, terms); the system browser by default.
  final Future<void> Function(Uri url)? openUrl;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Settings')),
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 800),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _AccountCard(auth: auth),
                const SizedBox(height: 16),
                const _AppearanceCard(),
                const SizedBox(height: 16),
                const _AiPlanCard(),
                const SizedBox(height: 16),
                const TemplateEditor(),
                const SizedBox(height: 16),
                const PlansEditor(),
                const SizedBox(height: 16),
                _SubscriptionCard(openUrl: openUrl),
                const SizedBox(height: 16),
                const SyncPanel(),
                const SizedBox(height: 16),
                _DataCard(auth: auth),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      );
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              child,
            ],
          ),
        ),
      );
}

/// Light, dark or follow the phone (a setting of this device).
class _AppearanceCard extends StatelessWidget {
  const _AppearanceCard();

  @override
  Widget build(BuildContext context) {
    final theme = AppScope.of(context).theme;
    return _SectionCard(
      title: 'Appearance',
      child: ListenableBuilder(
        listenable: theme,
        builder: (context, _) => SizedBox(
          width: double.infinity,
          child: SegmentedButton<ThemePreference>(
            showSelectedIcon: false,
            segments: const [
              ButtonSegment(value: ThemePreference.light, label: Text('Light'), icon: Icon(Icons.light_mode_outlined, size: 16)),
              ButtonSegment(value: ThemePreference.dark, label: Text('Dark'), icon: Icon(Icons.dark_mode_outlined, size: 16)),
              ButtonSegment(value: ThemePreference.system, label: Text('System'), icon: Icon(Icons.brightness_auto_outlined, size: 16)),
            ],
            selected: {theme.preference},
            onSelectionChanged: (selection) => theme.select(selection.first),
          ),
        ),
      ),
    );
  }
}

class _AccountCard extends StatelessWidget {
  const _AccountCard({required this.auth});

  final AuthController auth;

  Future<void> _setPassword(BuildContext context) async {
    final email = auth.session?.user.email;
    final password = await showDialog<String>(context: context, builder: (_) => const _SetPasswordDialog());
    if (password == null || !context.mounted) return;
    if (await auth.updatePassword(password)) {
      if (context.mounted) {
        showToast(context, 'Password set', description: email == null ? null : 'On the website, sign in with $email and this password.');
      }
    } else if (context.mounted) {
      showToast(context, auth.error ?? 'Could not set the password.', tone: ToastTone.error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    return ListenableBuilder(
      listenable: auth,
      builder: (context, _) {
        final user = auth.session?.user;
        // Someone who signed in with Apple (and maybe hid their email) has no password, so the website, which has no Apple sign-in,
        // cannot be used. A password, with the address shown here, fixes that.
        final needsPassword = user != null && user.usesApple && !user.hasPassword;
        return _SectionCard(
          title: 'Account',
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(user?.displayName ?? user?.email ?? 'Signed in')),
              OutlinedButton(onPressed: auth.signOut, child: const Text('Sign out')),
            ]),
            if (user?.email != null && user?.displayName != null)
              Padding(padding: const EdgeInsets.only(top: 4), child: Text(user!.email!, style: theme.textTheme.bodySmall?.copyWith(color: muted))),
            if (needsPassword) ...[
              const SizedBox(height: 12),
              Text(
                'You signed in with Apple. To use this account on the website too, set a password, then sign in there with '
                '${user.email ?? 'this account\'s email'} and that password.',
                style: theme.textTheme.bodySmall?.copyWith(color: muted),
              ),
              const SizedBox(height: 8),
              OutlinedButton(onPressed: auth.isWorking ? null : () => _setPassword(context), child: const Text('Set a password')),
            ],
          ]),
        );
      },
    );
  }
}

class _SetPasswordDialog extends StatefulWidget {
  const _SetPasswordDialog();

  @override
  State<_SetPasswordDialog> createState() => _SetPasswordDialogState();
}

class _SetPasswordDialogState extends State<_SetPasswordDialog> {
  final _form = GlobalKey<FormState>();
  final _password = TextEditingController();

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Set a password'),
        content: Form(
          key: _form,
          child: TextFormField(
            controller: _password,
            obscureText: true,
            autofocus: true,
            autofillHints: const [AutofillHints.newPassword],
            decoration: const InputDecoration(labelText: 'New password'),
            validator: (v) => (v ?? '').length < 6 ? 'Use at least 6 characters.' : null,
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              if (_form.currentState!.validate()) Navigator.pop(context, _password.text);
            },
            child: const Text('Set password'),
          ),
        ],
      );
}

/// What the current plan was generated from, which AI model builds plans, and a way to generate a new one.
class _AiPlanCard extends StatelessWidget {
  const _AiPlanCard();

  Future<void> _regenerate(BuildContext context) async {
    final services = AppScope.of(context);
    final confirmed = await confirmDialog(
      context,
      title: 'Replace all session templates?',
      description:
          'This will overwrite every session template with a new AI-generated plan. Your current exercises and customisations will be permanently lost.',
      confirmLabel: 'Continue',
      danger: true,
    );
    if (!confirmed || !context.mounted) return;
    // The wizard replaces the day screen, so close Settings (and anything above the day screen) first.
    Navigator.of(context).popUntil((r) => r.isFirst);
    services.startPlanRebuild();
  }

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    return _SectionCard(
      title: 'AI Plan',
      child: ListenableBuilder(
        listenable: Listenable.merge([services.workspace, services.aiSettings]),
        builder: (context, _) {
          final params = PlanParams.tryFromJson(services.workspace.planParams);
          final meta = services.workspace.planMeta;
          final ai = services.aiSettings;
          final split = meta?['split'];
          final progression = meta?['progression'];
          final notes = meta?['notes'];
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (params != null) ...[
              if (split is String && split.isNotEmpty) Text(split, style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
              if (progression is String && progression.isNotEmpty)
                Padding(padding: const EdgeInsets.only(top: 4), child: Text(progression, style: theme.textTheme.bodyMedium?.copyWith(color: muted))),
              if (notes is String && notes.isNotEmpty)
                Padding(padding: const EdgeInsets.only(top: 4), child: Text(notes, style: theme.textTheme.bodySmall?.copyWith(color: muted))),
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(describePlanParams(params), style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
              ),
            ] else
              Text('Generate a training plan tailored to your goal, experience and equipment.', style: theme.textTheme.bodyMedium?.copyWith(color: muted)),
            if (ai.enabledProviders.length > 1) ...[
              const SizedBox(height: 16),
              Text('AI MODEL', style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 1.4, fontWeight: FontWeight.w700, color: theme.colorScheme.outline)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final p in aiProviders.where((p) => ai.enabledProviders.contains(p.id)))
                  ChoiceChip(
                    label: Text(p.name),
                    selected: ai.provider == p.id,
                    onSelected: (_) async {
                      final error = await ai.select(p.id);
                      if (error != null && context.mounted) showToast(context, error, tone: ToastTone.error);
                    },
                  ),
              ]),
            ],
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () => _regenerate(context),
                icon: const Icon(Icons.auto_awesome, size: 16),
                label: Text(params == null ? 'Generate a plan' : 'Regenerate plan'),
              ),
            ),
          ]);
        },
      ),
    );
  }
}

class _SubscriptionCard extends StatefulWidget {
  const _SubscriptionCard({this.openUrl});

  final Future<void> Function(Uri url)? openUrl;

  @override
  State<_SubscriptionCard> createState() => _SubscriptionCardState();
}

class _SubscriptionCardState extends State<_SubscriptionCard> {
  Future<SubscriptionResult>? _result;
  ValueNotifier<int>? _revision;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final services = AppScope.of(context);
    if (_revision != services.subscriptionRevision) {
      _revision?.removeListener(_reload);
      _revision = services.subscriptionRevision..addListener(_reload);
    }
    _result ??= _fetch(services, force: false);
  }

  @override
  void dispose() {
    _revision?.removeListener(_reload);
    super.dispose();
  }

  Future<SubscriptionResult>? _fetch(AppServices services, {required bool force}) {
    final userId = services.signedInUserId;
    return userId == null || services.subscriptions == null ? null : services.subscriptions!.get(userId, force: force);
  }

  /// A purchase was accepted: read the plan again.
  void _reload() {
    if (!mounted) return;
    final next = _fetch(AppScope.of(context), force: true);
    setState(() {
      _result = next;
    });
  }

  Future<void> _open(Uri url) => (widget.openUrl ?? (u) async => launchUrl(u, mode: LaunchMode.externalApplication))(url);

  @override
  Widget build(BuildContext context) {
    final services = AppScope.of(context);
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    return _SectionCard(
      title: 'Subscription',
      child: _result == null
          ? Text('Not available right now.', style: TextStyle(color: muted))
          : FutureBuilder<SubscriptionResult>(
              future: _result,
              builder: (context, snapshot) {
                final result = snapshot.data;
                if (result == null) return Text('Loading...', style: TextStyle(color: muted));
                if (result.fetchError) {
                  return Text('Could not load subscription status. Please try again later.', style: TextStyle(color: muted));
                }
                final info = result.info;
                final purchases = services.purchases;
                if (info.plan == 'pro') return _proBody(context, info, purchases);
                if (purchases != null) return PaywallPanel(purchases: purchases, summary: freePlanSummary, openUrl: _open);
                return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text.rich(TextSpan(children: [
                    const TextSpan(text: "You're on the "),
                    const TextSpan(text: 'free plan', style: TextStyle(fontWeight: FontWeight.w700)),
                    TextSpan(text: '. $freePlanSummary'),
                  ]), style: theme.textTheme.bodyMedium?.copyWith(color: muted)),
                  const SizedBox(height: 8),
                  Text('You can upgrade in the Daily Grind web app.', style: theme.textTheme.bodySmall?.copyWith(color: muted)),
                ]);
              },
            ),
    );
  }

  Widget _proBody(BuildContext context, SubscriptionInfo info, ProPurchases? purchases) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final end = info.currentPeriodEnd;
    final storeName = info.source == 'apple' ? 'the App Store' : 'Google Play';
    final manageUrl = Uri.parse(info.source == 'apple' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions');
    final welcome = purchases?.message;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('Pro', style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
      if (end != null) Text('Renews ${formatDateTime(end).split(',').first}', style: theme.textTheme.bodySmall?.copyWith(color: muted)),
      if (info.status == 'past_due')
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text('There is a problem with your payment. Update your payment method in ${info.isStoreBilled ? storeName : 'your account'} to keep Pro.',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
        ),
      if (welcome != null && purchases?.messageIsError == false)
        Padding(padding: const EdgeInsets.only(top: 6), child: Text(welcome, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.primary))),
      const SizedBox(height: 8),
      Text(whenProEnds, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline)),
      const SizedBox(height: 8),
      if (info.isStoreBilled) ...[
        Text('Billed through $storeName.', style: theme.textTheme.bodySmall?.copyWith(color: muted)),
        const SizedBox(height: 8),
        OutlinedButton(onPressed: () => _open(manageUrl), child: const Text('Manage subscription')),
      ] else
        Text('Subscriptions are managed in the Daily Grind web app.', style: theme.textTheme.bodySmall?.copyWith(color: muted)),
    ]);
  }
}

/// The offer to buy Pro in the app: price, a button, "Restore purchases", and the renewal and cancellation wording the stores
/// require, with links to the terms and privacy policy.
class PaywallPanel extends StatelessWidget {
  const PaywallPanel({super.key, required this.purchases, required this.summary, required this.openUrl});

  final ProPurchases purchases;
  final String summary;
  final Future<void> Function(Uri url) openUrl;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final muted = scheme.onSurfaceVariant;
    return ListenableBuilder(
      listenable: purchases,
      builder: (context, _) {
        final product = purchases.product;
        final paywall = purchases.paywall;
        final storeName = purchases.platform == StorePlatform.apple ? 'Apple ID' : 'Google Play';
        final intro = Text.rich(TextSpan(children: [
          const TextSpan(text: "You're on the "),
          const TextSpan(text: 'free plan', style: TextStyle(fontWeight: FontWeight.w700)),
          TextSpan(text: '. $summary'),
        ]), style: theme.textTheme.bodyMedium?.copyWith(color: muted));

        if (purchases.stage == PurchaseStage.loading || purchases.stage == PurchaseStage.idle) {
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [intro, const SizedBox(height: 8), Text('Loading...', style: TextStyle(color: muted))]);
        }
        if (purchases.stage == PurchaseStage.unavailable || product == null) {
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            intro,
            const SizedBox(height: 8),
            Text("Pro isn't available to buy right now. Please try again later.", style: theme.textTheme.bodySmall?.copyWith(color: muted)),
          ]);
        }

        final busy = purchases.busy;
        final message = purchases.message;
        Widget link(String label, String url) => TextButton(
              style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8), minimumSize: const Size(0, 32), tapTargetSize: MaterialTapTargetSize.shrinkWrap),
              onPressed: () => openUrl(Uri.parse(url)),
              child: Text(label),
            );
        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          intro,
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: busy ? null : purchases.buy,
              child: purchases.stage == PurchaseStage.verifying
                  ? const Text('Confirming your purchase...')
                  : busy
                      ? const Text('Working...')
                      : Text('Upgrade to Pro · ${product.price} / ${paywall.period}'),
            ),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(onPressed: busy ? null : purchases.restore, child: const Text('Restore purchases')),
          ),
          if (message != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(message, style: theme.textTheme.bodySmall?.copyWith(color: purchases.messageIsError ? scheme.error : muted)),
            ),
          Text(
            'Payment is charged to your $storeName at confirmation. The subscription renews automatically each ${paywall.period} at '
            '${product.price} unless you cancel at least 24 hours before the end of the current period. You can manage or cancel it in '
            'your $storeName subscription settings.',
            style: theme.textTheme.bodySmall?.copyWith(color: scheme.outline),
          ),
          if (paywall.termsUrl.isNotEmpty || paywall.privacyUrl.isNotEmpty)
            Wrap(children: [
              if (paywall.termsUrl.isNotEmpty) link('Terms of use', paywall.termsUrl),
              if (paywall.privacyUrl.isNotEmpty) link('Privacy policy', paywall.privacyUrl),
            ]),
        ]);
      },
    );
  }
}

class _DataCard extends StatelessWidget {
  const _DataCard({required this.auth});

  final AuthController auth;

  Future<void> _deleteEverything(BuildContext context) async {
    final services = AppScope.of(context);
    // Deleting the account does not cancel a subscription held with a store: only the person can do that, in the store.
    final userId = services.signedInUserId;
    final subscription = userId == null ? null : (await services.subscriptions?.get(userId))?.info;
    if (!context.mounted) return;
    final storeNote = subscription != null && subscription.hasProAccess && subscription.isStoreBilled
        ? ' This does not cancel your ${subscription.source == 'apple' ? 'App Store' : 'Google Play'} subscription: cancel it in your store account settings, or you will keep being billed.'
        : '';
    // An account that signed in with Apple must also have Apple's access revoked (Apple requires it): Apple's sheet is shown once more
    // to confirm, which gives the server what it needs. Closing it does not stop the deletion.
    final usesApple = auth.session?.user.usesApple ?? false;
    final appleNote = usesApple && auth.supportsSignInWithApple
        ? ' You will be asked to confirm with Apple so that Daily Grind is also disconnected from your Apple ID; if you skip that, remove it in Settings → Apple ID → Sign in with Apple.'
        : '';
    final confirmed = await confirmDialog(
      context,
      title: 'Delete account and all data?',
      description:
          'This permanently removes your account, all workout history, templates, and cloud sync data. You will be signed out. This cannot be undone.$storeNote$appleNote',
      confirmLabel: 'Delete everything',
      danger: true,
    );
    if (!confirmed || !context.mounted) return;

    final appleCode = usesApple ? await auth.requestAppleAuthorizationCode() : null;
    if (!context.mounted) return;

    // Clear this device first, so the data is gone even if the server call fails.
    await services.wipeLocalData();

    // Delete the server-side data and the auth account. Sign out regardless of whether that succeeds.
    final api = services.api;
    if (api != null) {
      try {
        await api.deleteAccount(appleAuthorizationCode: appleCode);
      } on ApiException catch (e) {
        if (context.mounted) {
          showToast(
            context,
            'Server data deletion failed',
            description: 'Local data cleared. Server error: ${e.message}. Contact support if cloud data persists.',
            tone: ToastTone.error,
          );
        }
      }
    }
    await auth.signOut();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return _SectionCard(
      title: 'Data',
      child: Column(children: [
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: scheme.error, foregroundColor: scheme.onError),
            onPressed: () => _deleteEverything(context),
            icon: const Icon(Icons.delete_outline, size: 16),
            label: const Text('Delete account and all data'),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Permanently deletes your account, all workout history, templates, and cloud data. Cannot be undone.',
          textAlign: TextAlign.center,
          style: theme.textTheme.bodySmall?.copyWith(color: scheme.outline),
        ),
      ]),
    );
  }
}
