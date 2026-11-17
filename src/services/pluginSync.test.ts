import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@/plugins/api";
import type { MarketplacePlugin } from "@/stores/marketplaceStore";

const h = vi.hoisted(() => ({
  policy: [] as string[],
  recordInstall: vi.fn(async () => {}),
  recordUninstall: vi.fn(async () => {}),
  excluded: new Set<string>(),
  toggleExcluded: vi.fn(),
}));
vi.mock("@/stores/pluginRegistryStore", () => ({ policyInstallList: () => h.policy }));
vi.mock("@/stores/syncedPluginStore", () => ({
  useSyncedPluginStore: { getState: () => ({ recordInstall: h.recordInstall, recordUninstall: h.recordUninstall }) },
}));
vi.mock("@/stores/syncPrefsStore", () => ({
  useSyncPrefsStore: { getState: () => ({ isExcluded: (id: string) => h.excluded.has(id), toggleExcluded: h.toggleExcluded }) },
}));

import { recordUserInstall, recordUserUninstall, syncEligible } from "./pluginSync";

const entry = (over: Partial<MarketplacePlugin> = {}): MarketplacePlugin => ({
  id: "p1", name: "P1", author: "a", description: "d", repo: "o/p1", version: "1.0.0",
  tags: [], theme: false, sourceId: "voltius", hash: "h", cssHash: "c", ...over,
});
const manifest = { id: "p1", name: "Plugin One", version: "1.0.0", permissions: ["net"] } as PluginManifest;

beforeEach(() => {
  vi.clearAllMocks();
  h.policy = [];
  h.excluded = new Set();
});

describe("pluginSync", () => {
  it("records an eligible install with entry and manifest fields", async () => {
    await recordUserInstall(entry(), manifest);

    expect(h.recordInstall).toHaveBeenCalledWith("p1", {
      repo: "o/p1", source_id: "voltius", hash: "h", css_hash: "c", permissions: ["net"], name: "Plugin One",
    });
  });

  it("uses null hashes and empty permissions when absent", async () => {
    await recordUserInstall(entry({ hash: undefined, cssHash: undefined }), { id: "p1", name: "P1", version: "1" } as PluginManifest);

    expect(h.recordInstall).toHaveBeenCalledWith("p1", expect.objectContaining({ hash: null, css_hash: null, permissions: [] }));
  });

  it("policy-listed and local-source installs record nothing", async () => {
    h.policy = ["p1"];
    await recordUserInstall(entry(), manifest);
    h.policy = [];
    await recordUserInstall(entry({ sourceId: "local" }), manifest);
    await recordUserInstall(entry({ sourceId: "url" }), manifest);

    expect(h.recordInstall).not.toHaveBeenCalled();
    expect(syncEligible("p1", "voltius")).toBe(true);
  });

  it("user install clears this device's exclusion", async () => {
    h.excluded.add("p1");
    await recordUserInstall(entry(), manifest);

    expect(h.toggleExcluded).toHaveBeenCalledWith("p1");
    expect(h.recordInstall).toHaveBeenCalled();
  });

  it("leaves a non-excluded id's preference alone", async () => {
    await recordUserInstall(entry(), manifest);

    expect(h.toggleExcluded).not.toHaveBeenCalled();
  });

  it("uninstall delegates to recordUninstall", async () => {
    await recordUserUninstall("p1");

    expect(h.recordUninstall).toHaveBeenCalledWith("p1");
  });
});
