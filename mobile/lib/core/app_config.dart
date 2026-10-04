/// Build-time configuration, supplied with `--dart-define` (nothing secret: the Supabase anon key is public by
/// design, row-level security is what protects the data).
///
///   flutter run \
///     --dart-define=SUPABASE_URL=https://PROJECT.supabase.co \
///     --dart-define=SUPABASE_ANON_KEY=ANON_OR_PUBLISHABLE_KEY \
///     --dart-define=API_BASE_URL=https://YOUR-VERCEL-DEPLOYMENT
///
/// For the local stack use `API_BASE_URL=http://10.0.2.2:3010` from the Android emulator (the host's
/// localhost), or the machine's LAN address from a device.
library;

class ConfigException implements Exception {
  ConfigException(this.message);

  final String message;

  @override
  String toString() => 'ConfigException: $message';
}

class AppConfig {
  AppConfig._({
    required this.supabaseUrl,
    required this.supabaseAnonKey,
    required this.apiBaseUrl,
    required this.authRedirectUrl,
    required this.storeProProductId,
    required this.storeProPeriod,
    required this.termsUrl,
    required this.privacyUrl,
  });

  /// Validates and normalises the values; throws a [ConfigException] naming everything that is wrong at once.
  factory AppConfig({
    required String supabaseUrl,
    required String supabaseAnonKey,
    required String apiBaseUrl,
    String authRedirectUrl = defaultAuthRedirectUrl,
    String storeProProductId = '',
    String storeProPeriod = 'month',
    String termsUrl = '',
    String privacyUrl = '',
  }) {
    final problems = <String>[];
    String httpUrl(String name, String value) {
      final uri = Uri.tryParse(value.trim());
      if (value.trim().isEmpty) {
        problems.add('$name is missing');
      } else if (uri == null || !(uri.scheme == 'http' || uri.scheme == 'https') || uri.host.isEmpty) {
        problems.add('$name must be an http(s) URL');
      }
      return value.trim().replaceAll(RegExp(r'/+$'), '');
    }

    final url = httpUrl('SUPABASE_URL', supabaseUrl);
    final api = httpUrl('API_BASE_URL', apiBaseUrl);
    if (supabaseAnonKey.trim().isEmpty) problems.add('SUPABASE_ANON_KEY is missing');
    if (authRedirectUrl.trim().isEmpty) problems.add('AUTH_REDIRECT_URL is empty');
    if (problems.isNotEmpty) throw ConfigException(problems.join('; '));

    return AppConfig._(
      supabaseUrl: url,
      supabaseAnonKey: supabaseAnonKey.trim(),
      apiBaseUrl: api,
      authRedirectUrl: authRedirectUrl.trim(),
      storeProProductId: storeProProductId.trim(),
      storeProPeriod: storeProPeriod.trim().isEmpty ? 'month' : storeProPeriod.trim(),
      termsUrl: termsUrl.trim(),
      privacyUrl: privacyUrl.trim(),
    );
  }

  factory AppConfig.fromEnvironment() => AppConfig(
        supabaseUrl: const String.fromEnvironment('SUPABASE_URL'),
        supabaseAnonKey: const String.fromEnvironment('SUPABASE_ANON_KEY'),
        apiBaseUrl: const String.fromEnvironment('API_BASE_URL'),
        authRedirectUrl: const String.fromEnvironment('AUTH_REDIRECT_URL', defaultValue: defaultAuthRedirectUrl),
        storeProProductId: const String.fromEnvironment('STORE_PRO_PRODUCT_ID'),
        storeProPeriod: const String.fromEnvironment('STORE_PRO_PERIOD', defaultValue: 'month'),
        termsUrl: const String.fromEnvironment('TERMS_URL'),
        privacyUrl: const String.fromEnvironment('PRIVACY_URL'),
      );

  /// The deep link Supabase sends the user back to after Google sign-in, email confirmation and password
  /// reset. It must be registered in the Supabase dashboard (Authentication > URL Configuration > Redirect
  /// URLs) and declared in AndroidManifest.xml and Info.plist (done in this project).
  static const defaultAuthRedirectUrl = 'com.dailygrind.app://login-callback';

  final String supabaseUrl;
  final String supabaseAnonKey;

  /// Origin of the Vercel API, without a trailing slash.
  final String apiBaseUrl;
  final String authRedirectUrl;

  /// The subscription product id in App Store Connect and Google Play (the same id in both). Empty turns in-app purchase off.
  final String storeProProductId;

  /// How often the product renews, in words for the paywall text: "month" or "year". It must match the store product.
  final String storeProPeriod;

  /// The stores require links to terms of use and a privacy policy next to a subscription offer.
  final String termsUrl;
  final String privacyUrl;
}
