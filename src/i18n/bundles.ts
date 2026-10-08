type LocaleModule = { default: Record<string, unknown> };

const localeOf = (path: string) => {
  const segments = path.split("/");
  return segments[segments.length - 2];
};

export function assembleLocales(
  glob: Record<string, LocaleModule>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [path, mod] of Object.entries(glob)) {
    const bundle = (out[localeOf(path)] ??= {});
    for (const [k, v] of Object.entries(mod.default)) {
      bundle[k] = { ...(bundle[k] as object), ...(v as object) };
    }
  }
  return out;
}

export const englishBundle = assembleLocales(
  import.meta.glob("./locales/en/*.json", { eager: true }) as Record<string, LocaleModule>,
).en;

const otherLocales = import.meta.glob(["./locales/*/*.json", "!./locales/en/*.json"]) as Record<
  string,
  () => Promise<LocaleModule>
>;

export async function loadLocaleBundle(locale: string): Promise<Record<string, unknown> | undefined> {
  const files = Object.entries(otherLocales).filter(([path]) => localeOf(path) === locale);
  if (files.length === 0) return undefined;
  const modules = await Promise.all(files.map(async ([path, load]) => [path, await load()] as const));
  return assembleLocales(Object.fromEntries(modules))[locale];
}
