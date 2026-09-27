// A locale's key may carry a CLDR plural suffix English lacks (ru: _few/_many).
const PLURAL_SUFFIXES = ["_zero", "_one", "_two", "_few", "_many", "_other"];

export function baseKey(key: string): string {
  const suffix = PLURAL_SUFFIXES.find((s) => key.endsWith(s));
  return suffix ? key.slice(0, -suffix.length) : key;
}
