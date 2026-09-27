// Test-only: the real catalog, so tests read the shipped English copy, and empty
// storage, so update settings keep their defaults.
import type { PluginAPI } from "@/plugins/api";
import { createI18nAPI } from "@/plugins/domains/i18n";
import { messages } from "./i18n";
import { initDockerRuntime } from "./runtime";

export function initTestDockerRuntime(api: Partial<Record<keyof PluginAPI, unknown>> = {}): void {
  initDockerRuntime({
    i18n: createI18nAPI(messages),
    storage: { get: async () => null },
    ...api,
  } as unknown as PluginAPI);
}
