/**
 * Icon prefixes the host owns. Recorded as `preloadIcons` registers them, so the
 * guard in hostModules can never drift from what icons.ts actually adds.
 */
const _hostPrefixes = new Set<string>();

export function recordHostIconPrefix(prefix: string): void {
  _hostPrefixes.add(prefix);
}

export function isHostIconPrefix(prefix: string): boolean {
  return _hostPrefixes.has(prefix);
}
