import { test, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { MarketplacePlugin } from "@/stores/marketplaceStore";

const entry = (id: string, permissions: string[]): MarketplacePlugin =>
  ({ id, name: id, author: "a", description: "", repo: "", version: "1.0.0", tags: [], theme: false, sourceId: "voltius", permissions });

vi.mock("@/hooks/useBrowseCatalog", () => ({
  useBrowseCatalog: () => ({
    merged: [entry("plugin-cloudflare-sync", ["sync:write"]), entry("plugin-gist-sync", ["sync:write"]), entry("plugin-docker", ["ui"])],
    installedIds: new Set<string>(),
    seededActive: new Set<string>(),
    seededEntries: new Map(),
    appVersion: "0.36.0",
  }),
}));
vi.mock("@/plugins/runtime", () => ({
  getLoadedPlugins: () => [{ id: "plugin-gist-sync", name: "Gist", version: "1", permissions: ["sync:write"] }],
}));

import { useAvailableSyncProviders } from "./useAvailableSyncProviders";

test("lists catalogue sync providers that are neither installed nor loaded", () => {
  const { result } = renderHook(() => useAvailableSyncProviders());
  expect(result.current.available.map((p) => p.id)).toEqual(["plugin-cloudflare-sync"]);
  expect(result.current.appVersion).toBe("0.36.0");
});
