/// Which AI model builds the account's plans (the web app's `useUserSettings`): the providers this installation offers, the one
/// in effect, and changing it. Without the API (offline, signed out) only the default, Gemini, is offered.
library;

import 'package:flutter/foundation.dart';

import '../api/api_client.dart';

const defaultProvider = 'google';

class AiProviderInfo {
  const AiProviderInfo(this.id, this.name);

  final String id;
  final String name;
}

const aiProviders = [
  AiProviderInfo('google', 'Gemini'),
  AiProviderInfo('anthropic', 'Claude'),
  AiProviderInfo('openai', 'ChatGPT'),
];

class AiSettings extends ChangeNotifier {
  AiSettings(this._api);

  final ApiClient? _api;
  bool _disposed = false;
  List<String> _enabled = const [defaultProvider];
  String? _provider;

  /// The providers the server has keys for; always at least the default.
  List<String> get enabledProviders => _enabled;

  /// The provider plan generation will use. The default until the server has answered.
  String get provider => _provider ?? defaultProvider;

  /// True until the account's own setting has been read.
  bool get isLoading => _api != null && _provider == null;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> load() async {
    final api = _api;
    if (api == null) return;
    try {
      final enabled = await api.getEnabledProviders();
      if (enabled.isNotEmpty) _enabled = enabled;
    } catch (_) {
      _enabled = const [defaultProvider];
    }
    try {
      _provider = await api.getAiProvider();
    } catch (_) {
      _provider = defaultProvider;
    }
    _notify();
  }

  /// Switches provider. Null on success, otherwise what to tell the user (and the previous choice is restored). A non-default
  /// provider needs Pro, which the server enforces.
  Future<String?> select(String id) async {
    final api = _api;
    if (api == null || id == provider) return null;
    final previous = provider;
    _provider = id;
    _notify();
    try {
      _provider = await api.setAiProvider(id);
      _notify();
      return null;
    } on ApiException catch (e) {
      _provider = previous;
      _notify();
      return e.status == 402 ? 'Claude and ChatGPT are included with Pro.' : e.message;
    }
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
