import type { PluginLabel } from "./api";

/** Call at render, never at registration — that is what makes a function label
 *  follow the locale. Consumers must also depend on the locale to re-render. */
export function resolveLabel(label: PluginLabel): string {
  return typeof label === "function" ? label() : label;
}
