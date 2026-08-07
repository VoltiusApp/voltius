import type { PluginAPI } from "@/plugins/api";
import { createHostPluginAPI } from "@/plugins/runtime";

const PERMISSIONS = ["connections:read", "sessions:read", "audit"];

let cached: PluginAPI | null = null;

export function getMcpHostApi(): PluginAPI {
  cached ??= createHostPluginAPI("__mcp__", PERMISSIONS);
  return cached;
}
