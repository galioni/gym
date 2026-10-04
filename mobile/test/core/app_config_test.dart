import 'package:daily_grind/core/app_config.dart';
import 'package:flutter_test/flutter_test.dart';

AppConfig make({
  String supabaseUrl = 'https://abc.supabase.co/',
  String key = ' anon ',
  String api = 'https://app.vercel.app//',
  String? redirect,
}) =>
    AppConfig(
      supabaseUrl: supabaseUrl,
      supabaseAnonKey: key,
      apiBaseUrl: api,
      authRedirectUrl: redirect ?? AppConfig.defaultAuthRedirectUrl,
    );

void main() {
  test('normalises URLs and the key', () {
    final c = make();
    expect([c.supabaseUrl, c.apiBaseUrl, c.supabaseAnonKey], ['https://abc.supabase.co', 'https://app.vercel.app', 'anon']);
    expect(c.authRedirectUrl, 'com.dailygrind.app://login-callback');
  });

  test('allows http for the local stack', () => expect(make(api: 'http://10.0.2.2:3010').apiBaseUrl, 'http://10.0.2.2:3010'));

  test('reports everything wrong at once', () {
    expect(
      () => make(supabaseUrl: '', key: '  ', api: 'not a url'),
      throwsA(isA<ConfigException>().having((e) => e.message, 'message', allOf(
        contains('SUPABASE_URL is missing'),
        contains('SUPABASE_ANON_KEY is missing'),
        contains('API_BASE_URL must be an http(s) URL'),
      ))),
    );
  });

  test('rejects non-http schemes and an empty redirect', () {
    expect(() => make(api: 'ftp://x.com'), throwsA(isA<ConfigException>()));
    expect(() => make(redirect: ' '), throwsA(isA<ConfigException>()));
  });

  test('building without --dart-define values fails clearly rather than half-working', () {
    expect(AppConfig.fromEnvironment, throwsA(isA<ConfigException>()));
  });
}
