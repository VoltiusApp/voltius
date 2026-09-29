const sources = new WeakMap<object, string>();

export function copyingRulesOf<T extends object>(form: T, sourceId: string): T {
  sources.set(form, sourceId);
  return form;
}

export function rulesSourceOf(form: object): string | undefined {
  return sources.get(form);
}
