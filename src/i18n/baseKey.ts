// CLDR plural categories used across our locales. English only has one/other;
// Russian's CLDR rules need one/few/many/other, so a locale's key can carry a
// plural suffix that English doesn't — strip suffixes before comparing bases.
// Shared by the host and plugin catalog parity tests.
const PLURAL_SUFFIXES = ["_zero", "_one", "_two", "_few", "_many", "_other"];

export function baseKey(key: string): string {
  const suffix = PLURAL_SUFFIXES.find((s) => key.endsWith(s));
  return suffix ? key.slice(0, -suffix.length) : key;
}
