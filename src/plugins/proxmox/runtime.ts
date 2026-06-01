import type { PluginAPI } from "@/plugins/api";

let pluginApi: PluginAPI | null = null;

export function initProxmoxRuntime(api: PluginAPI): void {
  pluginApi = api;
}

export function getProxmoxApi(): PluginAPI | null {
  return pluginApi;
}
