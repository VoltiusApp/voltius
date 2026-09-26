// Test-only (nothing in the bundle imports it): captures an api whose i18n is the
// real catalog, so component tests read the English copy users see, and whose
// storage is empty, so update settings fall back to their defaults.
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
