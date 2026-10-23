type LocaleModule = { default: Record<string, unknown> };

const localeOf = (path: string) => {
  const segments = path.split("/");
  return segments[segments.length - 2];
};

function declaredFallback(bundle: Record<string, unknown>): string | undefined {
  const meta = bundle._meta;
  return meta && typeof meta === "object" ? (meta as { fallback?: string }).fallback : undefined;
}

export function assembleLocales(
  glob: Record<string, LocaleModule>,
): Record<string, Record<string, unknown>> {
  const raw: Record<string, Record<string, unknown>> = {};
  for (const [path, mod] of Object.entries(glob)) {
    const bundle = (raw[localeOf(path)] ??= {});
    for (const [k, v] of Object.entries(mod.default)) {
      bundle[k] = { ...(bundle[k] as object), ...(v as object) };
    }
  }

  // A locale such as pt-BR may ship only a _meta.json declaring `fallback: "pt"`.
  // Resolve those chains so its bundle carries the base language's strings.
  const resolved: Record<string, Record<string, unknown>> = {};
  const resolving = new Set<string>();
  const resolve = (locale: string): Record<string, unknown> => {
    const cached = resolved[locale];
    if (cached) return cached;
    const bundle = raw[locale];
    if (!bundle) return {};
    const fallback = declaredFallback(bundle);
    if (!fallback || fallback === locale || resolving.has(locale) || !raw[fallback]) {
      resolved[locale] = bundle;
      return bundle;
    }
    resolving.add(locale);
    const merged = { ...resolve(fallback), ...bundle };
    resolving.delete(locale);
    resolved[locale] = merged;
    return merged;
  };

  return Object.fromEntries(Object.keys(raw).map((locale) => [locale, resolve(locale)]));
}

export const englishBundle = assembleLocales(
  import.meta.glob("./locales/en/*.json", { eager: true }) as Record<string, LocaleModule>,
).en;

const otherLocales = import.meta.glob(["./locales/*/*.json", "!./locales/en/*.json"]) as Record<
  string,
  () => Promise<LocaleModule>
>;

/** Walks `_meta.fallback` from `locale` so a regional bundle also loads its base language. */
async function localeChain(locale: string): Promise<Set<string>> {
  const chain = new Set([locale]);
  let current = locale;
  for (;;) {
    const load = otherLocales[`./locales/${current}/_meta.json`];
    if (!load) break;
    const fallback = declaredFallback((await load()).default);
    if (!fallback || chain.has(fallback)) break;
    chain.add(fallback);
    current = fallback;
  }
  return chain;
}

export async function loadLocaleBundle(locale: string): Promise<Record<string, unknown> | undefined> {
  const chain = await localeChain(locale);
  const files = Object.entries(otherLocales).filter(([path]) => chain.has(localeOf(path)));
  if (files.length === 0) return undefined;
  const modules = await Promise.all(files.map(async ([path, load]) => [path, await load()] as const));
  return assembleLocales(Object.fromEntries(modules))[locale];
}
