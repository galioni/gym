/// A JavaScript `undefined` value. The web app hashes objects that carry explicit `undefined` keys (its
/// sanitisers produce them), and its serialiser writes the token `undefined` for them, so hashes that other
/// devices stored (sync tombstones in the cloud) contain it. A [jsUndefined] in a value serialises as that token.
library;

class JsUndefined {
  const JsUndefined();
}

const jsUndefined = JsUndefined();
