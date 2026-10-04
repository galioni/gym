/// Port of `application/sync/contentHash.ts`. Output must be byte-identical to the web app's for the same
/// value (see contract/contentHash.fixtures.json), otherwise a day edited on one client looks like a
/// conflict on the other.
library;

import '../domain/js_undefined.dart';

const _m32 = 0xFFFFFFFF;

int _toInt32(int x) {
  final v = x & _m32;
  return v >= 0x80000000 ? v - 0x100000000 : v;
}

/// JS `Math.imul`.
int _imul(int a, int b) => _toInt32((a & _m32) * (b & _m32));

/// JS `JSON.stringify` for a string: escapes only `"`, `\`, control chars; leaves non-ASCII as is.
String _jsonString(String s) {
  final b = StringBuffer('"');
  for (final c in s.codeUnits) {
    switch (c) {
      case 0x22:
        b.write(r'\"');
      case 0x5C:
        b.write(r'\\');
      case 0x08:
        b.write(r'\b');
      case 0x0C:
        b.write(r'\f');
      case 0x0A:
        b.write(r'\n');
      case 0x0D:
        b.write(r'\r');
      case 0x09:
        b.write(r'\t');
      default:
        if (c < 0x20) {
          b.write('\\u${c.toRadixString(16).padLeft(4, '0')}');
        } else {
          b.writeCharCode(c);
        }
    }
  }
  b.write('"');
  return b.toString();
}

/// Deterministic JSON with sorted keys. Keys sort by code unit, which equals the web app's `localeCompare`
/// for the ASCII camelCase keys the synced shapes use; do not feed it user-chosen keys.
String stableSerialize(Object? value) {
  if (value == null) return 'null';
  if (value is JsUndefined) return 'undefined';
  if (value is String) return _jsonString(value);
  if (value is bool) return value ? 'true' : 'false';
  if (value is num) {
    if (value is double && value == value.truncateToDouble() && value.abs() < 1e21) return value.toInt().toString();
    return value.toString();
  }
  if (value is List) return '[${value.map(stableSerialize).join(',')}]';
  if (value is Map) {
    final keys = value.keys.cast<String>().toList()..sort();
    return '{${keys.map((k) => '${_jsonString(k)}:${stableSerialize(value[k])}').join(',')}}';
  }
  throw ArgumentError('Cannot serialise ${value.runtimeType}');
}

/// cyrb53, 53-bit, as base-36 (same as the web app).
String hashString(String input) {
  var h1 = _toInt32(0xdeadbeef);
  var h2 = 0x41c6ce57;
  for (final code in input.codeUnits) {
    h1 = _imul(h1 ^ code, 2654435761);
    h2 = _imul(h2 ^ code, 1597334677);
  }
  h1 = _toInt32(_imul(h1 ^ ((h1 & _m32) >> 16), 2246822507) ^ _imul(h2 ^ ((h2 & _m32) >> 13), 3266489909));
  h2 = _toInt32(_imul(h2 ^ ((h2 & _m32) >> 16), 2246822507) ^ _imul(h1 ^ ((h1 & _m32) >> 13), 3266489909));
  return (4294967296 * (2097151 & h2) + (h1 & _m32)).toRadixString(36);
}

String entityHash(Object? data) => hashString(stableSerialize(data));
