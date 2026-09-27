type LocaleModule = { default: Record<string, unknown> };

export function assembleLocales(
  glob: Record<string, LocaleModule>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [path, mod] of Object.entries(glob)) {
    const segments = path.split("/");
    const bundle = (out[segments[segments.length - 2]] ??= {});
    for (const [k, v] of Object.entries(mod.default)) {
      bundle[k] = { ...(bundle[k] as object), ...(v as object) };
    }
  }
  return out;
}

export const localeBundles = assembleLocales(
  import.meta.glob("./locales/*/*.json", { eager: true }) as Record<string, LocaleModule>,
);
