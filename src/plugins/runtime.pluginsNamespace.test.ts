import { describe, it, expect, vi } from "vitest";
import { createHostPluginAPI } from "./runtime";

vi.mock("./domains/plugins", () => ({
  listPlugins: vi.fn(async () => []),
  installPlugin: vi.fn(async () => ({ ok: true, result: { id: "x" } })),
  uninstallPlugin: vi.fn(async () => ({ ok: true, result: { id: "x" } })),
  setPluginEnabled: vi.fn(async () => ({ ok: true, result: { id: "x" } })),
  updatePlugin: vi.fn(async () => ({ ok: true, result: { id: "x" } })),
  readPluginConfig: vi.fn(async () => ({ ok: true, result: {} })),
  writePluginConfig: vi.fn(async () => ({ ok: true, result: { key: "k", effective: 1 } })),
  listSources: vi.fn(async () => []),
  searchCatalog: vi.fn(async () => []),
  addSource: vi.fn(async () => ({ ok: true, result: { id: "s" } })),
  removeSource: vi.fn(async () => ({ ok: true, result: { id: "s" } })),
}));

describe("api.plugins", () => {
  it("throws when the plugin did not declare plugins:manage", async () => {
    const api = createHostPluginAPI("test:plugins", ["storage"]);
    await expect(api.plugins.list()).rejects.toThrow(/plugins:manage/);
  });

  it("works when the permission is declared", async () => {
    const api = createHostPluginAPI("test:plugins", ["plugins:manage"]);
    await expect(api.plugins.list()).resolves.toEqual([]);
  });
});
