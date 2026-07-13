import { describe, test, expect, vi, beforeEach } from "vitest";
import { register } from "./index";
import type { PluginAPI } from "@/plugins/api";

// ─── Mock API builder ──────────────────────────────────────────────────────
// Minimal PluginAPI stub exercising only the surface ssh-config's register()
// and sync() touch. isActive is parameterised so we can assert the plugin stays
// inert while disabled.

function makeApi(active: boolean) {
  const watch = vi.fn(() => () => {});
  const registerSettingsPage = vi.fn(() => () => {});
  const connectionsList = vi.fn(async () => []);

  const api = {
    isActive: () => active,
    fs: {
      // No ~/.ssh/config present → sync() would early-return, but if exists is
      // called at all it proves the initial sync fired.
      exists: vi.fn(async () => false),
      readText: vi.fn(async () => ""),
      writeText: vi.fn(async () => {}),
      watch,
    },
    connections: { list: connectionsList },
    keys: { list: vi.fn(async () => []) },
    identities: { list: vi.fn(async () => []) },
    storage: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    },
    events: { on: vi.fn(() => () => {}), emit: vi.fn() },
    ui: { registerSettingsPage },
    lifecycle: { waitForLoginSync: vi.fn(() => Promise.resolve()) },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as PluginAPI;

  return { api, watch, registerSettingsPage, connectionsList };
}

// Let every scheduled microtask/`.then` chain settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("ssh-config register honors isActive()", () => {
  beforeEach(() => vi.clearAllMocks());

  test("disabled plugin does not watch or sync", async () => {
    const { api, watch, connectionsList, registerSettingsPage } = makeApi(false);
    const cleanup = register(api);
    await flush();
    await flush();

    expect(watch).not.toHaveBeenCalled();
    expect(connectionsList).not.toHaveBeenCalled();
    // Settings page must still be available while disabled.
    expect(registerSettingsPage).toHaveBeenCalledTimes(1);

    if (typeof cleanup === "function") cleanup();
  });

  test("enabled plugin starts the file watcher", async () => {
    const { api, watch } = makeApi(true);
    const cleanup = register(api);
    await flush();
    await flush();

    expect(watch).toHaveBeenCalled();

    if (typeof cleanup === "function") cleanup();
  });
});
