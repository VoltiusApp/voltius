import { describe, test, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
const loadPlugin = vi.fn();
const consentSpy = vi.hoisted(() => vi.fn(() => true));
const h = vi.hoisted(() => ({ removed: new Set<string>(), installedIds: new Set<string>() }));
const addBanner = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("./runtime", () => ({ loadPlugin: (...a: unknown[]) => loadPlugin(...a) }));
vi.mock("@/stores/pluginRegistryStore", () => ({
  usePluginRegistryStore: { getState: () => ({ isEnabled: () => true }) },
}));
vi.mock("@/stores/seededTombstoneStore", () => ({
  useSeededTombstoneStore: { getState: () => ({ isRemoved: (id: string) => h.removed.has(id) }) },
}));
vi.mock("@/stores/marketplaceStore", () => ({
  useMarketplaceStore: {
    getState: () => ({ installedMeta: [...h.installedIds].map((id) => ({ id })) }),
  },
}));
vi.mock("./importPluginModule", () => ({
  importPluginModule: vi.fn(async () => ({ register: () => {} })),
  pluginRegisterOf: (_mod: unknown) => () => {},
}));
vi.mock("./gatedPermissions", () => ({ requiresInstallConsent: consentSpy }));
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: { getState: () => ({ addBanner }) },
}));
vi.mock("@/stores/uiStore", () => ({ useUIStore: { getState: () => ({ openSettings: () => {} }) } }));
vi.mock("@/lib/logger", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { loadSeededPlugins } from "./seeded";

describe("loadSeededPlugins", () => {
  beforeEach(() => {
    invoke.mockReset();
    loadPlugin.mockReset();
    consentSpy.mockClear();
    h.removed.clear();
    h.installedIds.clear();
    addBanner.mockClear();
  });

  test("returns without throwing when there are no seeded plugins", async () => {
    invoke.mockResolvedValueOnce([]);
    await loadSeededPlugins();
    expect(loadPlugin).not.toHaveBeenCalled();
  });

  test("one plugin failing to load does not prevent the others", async () => {
    invoke.mockImplementation(async (cmd: string, args: Record<string, string>) => {
      if (cmd === "plugins_list_seeded") return ["broken", "ok"];
      if (cmd === "plugin_seeded_read") {
        if (args.id === "broken") throw new Error("missing");
        return JSON.stringify({ id: "ok", version: "1.0.0", permissions: [] });
      }
      return "";
    });
    await loadSeededPlugins();
    // "broken" throws on its manifest read; "ok" must still be reached.
    expect(invoke).toHaveBeenCalledWith("plugin_seeded_read", { id: "ok", filename: "index.js" });
  });

  test("a plugin whose manifest is unreadable does not abort the loop", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "plugins_list_seeded") return ["a", "b"];
      throw new Error("boom");
    });
    await expect(loadSeededPlugins()).resolves.toBeUndefined();
    expect(loadPlugin).not.toHaveBeenCalled();
  });

  test("a seeded plugin declaring gated permissions loads without consulting the install-consent gate", async () => {
    invoke.mockImplementation(async (cmd: string, args: Record<string, string>) => {
      if (cmd === "plugins_list_seeded") return ["docker"];
      if (cmd === "plugin_seeded_read" && args.filename === "manifest.json") {
        return JSON.stringify({
          id: "plugin-docker",
          version: "1.0.0",
          permissions: ["docker:manage", "docker:read"],
        });
      }
      return "export const register = () => {};";
    });

    await loadSeededPlugins();

    expect(consentSpy).not.toHaveBeenCalled();
    expect(loadPlugin).toHaveBeenCalledWith(
      expect.objectContaining({ id: "plugin-docker" }),
      expect.any(Function),
      expect.any(Boolean),
      true,
      expect.any(String),
    );
  });

  test("a tombstoned seeded plugin is not registered", async () => {
    h.removed.add("plugin-docker");
    invoke.mockImplementation(async (cmd: string, args: Record<string, string>) => {
      if (cmd === "plugins_list_seeded") return ["docker"];
      if (cmd === "plugin_seeded_read" && args.filename === "manifest.json") {
        return JSON.stringify({ id: "plugin-docker", version: "1.0.0", permissions: [] });
      }
      return "export const register = () => {};";
    });

    await loadSeededPlugins();

    expect(loadPlugin).not.toHaveBeenCalled();
  });

  test("an externally-installed id is skipped by the seeded loader", async () => {
    h.installedIds.add("plugin-docker");
    invoke.mockImplementation(async (cmd: string, args: Record<string, string>) => {
      if (cmd === "plugins_list_seeded") return ["docker"];
      if (cmd === "plugin_seeded_read" && args.filename === "manifest.json") {
        return JSON.stringify({ id: "plugin-docker", version: "1.0.0", permissions: [] });
      }
      return "export const register = () => {};";
    });

    await loadSeededPlugins();

    expect(loadPlugin).not.toHaveBeenCalled();
  });

  test("a restored (non-tombstoned) seeded plugin is registered normally", async () => {
    invoke.mockImplementation(async (cmd: string, args: Record<string, string>) => {
      if (cmd === "plugins_list_seeded") return ["docker"];
      if (cmd === "plugin_seeded_read" && args.filename === "manifest.json") {
        return JSON.stringify({ id: "plugin-docker", version: "1.0.0", permissions: [] });
      }
      return "export const register = () => {};";
    });

    await loadSeededPlugins();

    expect(loadPlugin).toHaveBeenCalledOnce();
  });

  // A webview-level breakage (an unsupported CSP directive, say) takes out every
  // built-in at once while the app still boots and looks healthy — the failure this
  // banner exists to make visible.
  describe("total-failure banner", () => {
    function seeded(ids: string[], readFails: boolean) {
      invoke.mockImplementation(async (cmd: string, args: Record<string, string>) => {
        if (cmd === "plugins_list_seeded") return ids;
        if (cmd === "plugin_seeded_read" && args.filename === "manifest.json") {
          if (readFails) throw new Error("blocked");
          return JSON.stringify({ id: `plugin-${args.id}`, version: "1.0.0", permissions: [] });
        }
        return "export const register = () => {};";
      });
    }

    test("raises a banner when every seeded plugin fails", async () => {
      seeded(["docker", "monitoring"], true);
      await loadSeededPlugins();
      expect(addBanner).toHaveBeenCalledOnce();
      expect(addBanner.mock.calls[0][0]).toMatchObject({
        severity: "error",
        source: { kind: "plugin", id: "core" },
      });
    });

    test("stays quiet when at least one loads", async () => {
      invoke.mockImplementation(async (cmd: string, args: Record<string, string>) => {
        if (cmd === "plugins_list_seeded") return ["broken", "ok"];
        if (cmd === "plugin_seeded_read" && args.filename === "manifest.json") {
          if (args.id === "broken") throw new Error("blocked");
          return JSON.stringify({ id: "plugin-ok", version: "1.0.0", permissions: [] });
        }
        return "export const register = () => {};";
      });
      await loadSeededPlugins();
      expect(loadPlugin).toHaveBeenCalledOnce();
      expect(addBanner).not.toHaveBeenCalled();
    });

    // The false positive that would cry wolf on a legitimate setup.
    test("stays quiet when the user has uninstalled every built-in", async () => {
      h.removed.add("plugin-docker");
      h.removed.add("plugin-monitoring");
      seeded(["docker", "monitoring"], false);
      await loadSeededPlugins();
      expect(loadPlugin).not.toHaveBeenCalled();
      expect(addBanner).not.toHaveBeenCalled();
    });

    test("stays quiet when every built-in is superseded by an external install", async () => {
      h.installedIds.add("plugin-docker");
      seeded(["docker"], false);
      await loadSeededPlugins();
      expect(addBanner).not.toHaveBeenCalled();
    });

    test("stays quiet when there are no seeded plugins at all", async () => {
      seeded([], false);
      await loadSeededPlugins();
      expect(addBanner).not.toHaveBeenCalled();
    });
  });
});
