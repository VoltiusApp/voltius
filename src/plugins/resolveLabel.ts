import type { PluginLabel } from "./api";
import type { LazyLabel } from "@/i18n";

/** Call at render, never at registration — that is what makes a function label
 *  follow the locale. Consumers must also depend on the locale to re-render. */
export function resolveLabel(label: PluginLabel): string {
  return typeof label === "function" ? label() : label;
}

/** The English text of a lazyT() label, so search also matches it when the app
 *  runs in another language. Undefined for plain strings and plugin functions. */
export function englishLabel(label: PluginLabel): string | undefined {
  return typeof label === "function" && "en" in label ? (label as LazyLabel).en() : undefined;
}
