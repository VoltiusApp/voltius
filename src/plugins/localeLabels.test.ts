import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { loadPlugin, unloadPlugin } from "./runtime";
import { resolveLabel } from "./resolveLabel";
import { usePluginStore } from "@/stores/pluginStore";
import { useLocaleStore } from "@/stores/localeStore";
import type { PluginManifest, PluginRegisterFn } from "./api";

// register() runs once, so a label translated at registration froze at the boot
// locale. A function label is resolved by the host at render instead.

const manifest: PluginManifest = {
  id: "t", name: "t", version: "1",
  permissions: ["ui", "right-panel", "settings-page"],
};

const register: PluginRegisterFn = (api) => {
  api.i18n.register({
    en: { title: "Metrics" },
    fr: { title: "Métriques" },
  });
  api.ui.registerRightPanelSection({
    id: "panel", label: () => api.i18n.t("title"), icon: "x", component: () => null,
  });
  api.ui.registerSettingsPage({
    id: "settings", label: () => api.i18n.t("title"), icon: "x", component: () => null,
  });
};

function sectionLabel(): string {
  return resolveLabel(usePluginStore.getState().rightPanelSections.get("t:panel")!.label);
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "en" });
  usePluginStore.setState({ rightPanelSections: new Map(), settingsPages: new Map() });
});
afterEach(() => {
  try { unloadPlugin("t"); } catch { /* noop */ }
  useLocaleStore.setState({ locale: "en" });
});

describe("plugin labels follow the locale", () => {
  test("a right-panel label resolves in the current locale", () => {
    loadPlugin(manifest, register, true, false);
    expect(sectionLabel()).toBe("Metrics");
  });

  test("it re-resolves after a locale change, without re-registering", () => {
    loadPlugin(manifest, register, true, false);
    useLocaleStore.setState({ locale: "fr" });
    expect(sectionLabel()).toBe("Métriques");
  });

  test("a settings-page label follows the locale too", () => {
    loadPlugin(manifest, register, true, false);
    useLocaleStore.setState({ locale: "fr" });
    const page = usePluginStore.getState().settingsPages.get("t:settings")!;
    expect(resolveLabel(page.label)).toBe("Métriques");
  });

  test("a plain string label still works", () => {
    loadPlugin(manifest, (api) => {
      api.ui.registerRightPanelSection({
        id: "panel", label: "Plain", icon: "x", component: () => null,
      });
    }, true, false);
    expect(sectionLabel()).toBe("Plain");
  });
});
