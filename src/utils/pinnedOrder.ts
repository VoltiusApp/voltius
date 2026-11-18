export function orderPinnedFirst<T>(items: T[], isPinned: (item: T) => boolean): T[] {
  return [...items.filter(isPinned), ...items.filter((item) => !isPinned(item))];
}
