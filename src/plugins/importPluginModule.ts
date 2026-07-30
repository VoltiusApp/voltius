import { resolveHostSpecifiers } from "./hostModules";
import type { PluginRegisterFn } from "./api";

/**
 * A plugin bundle's shape. Marketplace plugins conventionally `export default` their
 * register function; a lib-mode build of a first-party plugin emits it as a named
 * `register` export instead. Accept both — reading only `default` silently produces
 * `register is not a function` at load time, which the loaders swallow.
 */
export interface PluginModule {
  default?: PluginRegisterFn;
  register?: PluginRegisterFn;
}

/** The register function from either supported export convention. */
export function pluginRegisterOf(mod: PluginModule): PluginRegisterFn {
  const fn = mod.default ?? mod.register;
  if (typeof fn !== "function") {
    throw new Error("plugin bundle exports no register function (default or named)");
  }
  return fn;
}

/**
 * Inject a plugin's stylesheet (if it has one) into the document. Idempotent per
 * plugin id, so a re-load doesn't pile up duplicate <style> tags.
 */
export function injectPluginStyle(pluginId: string, css: string): void {
  const elId = pluginStyleElementId(pluginId);
  const existing = document.getElementById(elId);
  if (existing) existing.remove();
  const style = document.createElement("style");
  style.id = elId;
  style.textContent = css;
  document.head.appendChild(style);
}

/** Remove a plugin's injected stylesheet, if any. No-op if it never injected one. */
export function removePluginStyle(pluginId: string): void {
  document.getElementById(pluginStyleElementId(pluginId))?.remove();
}

function pluginStyleElementId(pluginId: string): string {
  return `voltius-plugin-style-${pluginId}`;
}

/** Turn a plugin bundle's source into a live module with its host imports resolved. */
export async function importPluginModule(
  jsText: string,
  css?: string,
  pluginId?: string,
): Promise<unknown> {
  if (css && pluginId) injectPluginStyle(pluginId, css);
  const url = URL.createObjectURL(
    new Blob([await resolveHostSpecifiers(jsText)], { type: "text/javascript" }),
  );
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
