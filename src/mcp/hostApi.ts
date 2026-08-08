import type { PluginAPI } from "@/plugins/api";
import { createHostPluginAPI } from "@/plugins/runtime";
import { ALL_PERMISSIONS } from "@voltius/tools";

export const PERMISSIONS: string[] = [...ALL_PERMISSIONS];

let cached: PluginAPI | null = null;

export function getMcpHostApi(): PluginAPI {
  cached ??= createHostPluginAPI("__mcp__", PERMISSIONS);
  return cached;
}
