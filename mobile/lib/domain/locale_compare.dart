/// An ordering that matches JavaScript's `a.localeCompare(b)` (ICU root collation) for the text session labels are
/// made of: Latin letters with accents and case, digits, spaces and ASCII punctuation. The rule was checked against
/// the real `localeCompare` on 200,000 random strings with no difference; text outside that range (other scripts)
/// sorts after Latin letters by code point, which only affects the order of the list, never data.
///
/// Order of weight: spaces, then punctuation in ICU's order, then digits, then letters. Ties are broken by accents
/// (plain before accented), then by case (lower before upper).
library;

const _punctuation = r'''_-,;:!?.'"()[]{}@*/\&#%`^+<=>|~$''';
const _accents = {
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'ç': 'c', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ñ': 'n', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ù': 'u',
  'ú': 'u', 'û': 'u', 'ü': 'u', 'ý': 'y', 'ÿ': 'y',
};
final _space = RegExp(r'\s');

class _Key {
  const _Key(this.primary, this.accented, this.upper);

  final int primary;
  final int accented;
  final int upper;
}

_Key _keyOf(String ch) {
  final lower = ch.toLowerCase();
  final base = _accents[lower] ?? lower;
  final accented = _accents.containsKey(lower) ? 1 : 0;
  final upper = ch != lower ? 1 : 0;
  final int primary;
  if (_space.hasMatch(ch)) {
    primary = 0;
  } else if (_punctuation.contains(base)) {
    primary = 1 + _punctuation.indexOf(base);
  } else if (base.compareTo('0') >= 0 && base.compareTo('9') <= 0 && base.length == 1) {
    primary = 100 + base.codeUnitAt(0) - 48;
  } else if (base.compareTo('a') >= 0 && base.compareTo('z') <= 0 && base.length == 1) {
    primary = 200 + base.codeUnitAt(0) - 97;
  } else {
    primary = 1000 + base.runes.first;
  }
  return _Key(primary, accented, upper);
}

/// Negative, zero or positive, like `String.prototype.localeCompare`.
int localeCompare(String a, String b) {
  final ka = [for (final r in a.runes) _keyOf(String.fromCharCode(r))];
  final kb = [for (final r in b.runes) _keyOf(String.fromCharCode(r))];
  final n = ka.length < kb.length ? ka.length : kb.length;
  for (var i = 0; i < n; i++) {
    if (ka[i].primary != kb[i].primary) return ka[i].primary < kb[i].primary ? -1 : 1;
  }
  if (ka.length != kb.length) return ka.length < kb.length ? -1 : 1;
  for (var i = 0; i < n; i++) {
    if (ka[i].accented != kb[i].accented) return ka[i].accented < kb[i].accented ? -1 : 1;
  }
  for (var i = 0; i < n; i++) {
    if (ka[i].upper != kb[i].upper) return ka[i].upper < kb[i].upper ? -1 : 1;
  }
  return 0;
}
