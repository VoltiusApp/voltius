export function toggleKey<T>(items: T[], item: T, key: (t: T) => string): T[] {
  const k = key(item);
  return items.some((x) => key(x) === k) ? items.filter((x) => key(x) !== k) : [...items, item];
}

export function allKeysSelected<T>(items: T[], visible: T[], key: (t: T) => string): boolean {
  if (visible.length === 0) return false;
  const have = new Set(items.map(key));
  return visible.every((v) => have.has(key(v)));
}

export function toggleAllKeys<T>(items: T[], visible: T[], key: (t: T) => string): T[] {
  return allKeysSelected(items, visible, key) ? [] : visible;
}

/** Same array when nothing was dropped. */
export function pruneKeys<T>(items: T[], live: T[], key: (t: T) => string): T[] {
  const present = new Set(live.map(key));
  const kept = items.filter((x) => present.has(key(x)));
  return kept.length === items.length ? items : kept;
}
