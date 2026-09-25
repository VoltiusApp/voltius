import { useT } from "@voltius/ui";
import type { PluginAPI } from "@/plugins/api";

let pluginApi: PluginAPI | null = null;

export function initProxmoxRuntime(api: PluginAPI): void {
  pluginApi = api;
}

export function getProxmoxApi(): PluginAPI | null {
  return pluginApi;
}

/** `t` for the panel's components, which only render after register() ran.
 *  Same shape as docker's useDockerT: each bundle owns its own api singleton. */
export function useProxmoxT(): PluginAPI["i18n"]["t"] {
  return useT(pluginApi!);
}
