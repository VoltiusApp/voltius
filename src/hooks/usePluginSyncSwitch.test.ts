// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({
  excluded: [] as string[],
  effective: { configured: false, paused: true },
  toggleExcluded: vi.fn(),
  blockedReason: vi.fn((..._args: unknown[]): string | null => null),
}));

vi.mock("@/hooks/useSyncProviders", () => ({ useSyncProviders: () => ({ providers: [], effective: h.effective }) }));
vi.mock("@/services/pluginSync", () => ({
  installedSourceId: (id: string, seeded: Map<string, unknown>) => (seeded.has(id) ? "voltius" : "local"),
  pluginSyncBlockedReason: h.blockedReason,
}));
vi.mock("@/stores/syncPrefsStore", () => ({
  useSyncPrefsStore: Object.assign(
    (sel: (s: { excludedIds: string[]; syncTypes: object }) => unknown) => sel({ excludedIds: h.excluded, syncTypes: {} }),
    { getState: () => ({ toggleExcluded: h.toggleExcluded }) },
  ),
}));
vi.mock("@/stores/lanSyncStore", () => ({ useLanSyncStore: (sel: (s: { known: object }) => unknown) => sel({ known: {} }) }));

import { usePluginSyncSwitch } from "./usePluginSyncSwitch";

const seeded = new Map([["b1", { folder: "b1", manifest: { id: "b1" } }]]) as unknown as Parameters<typeof usePluginSyncSwitch>[1];

beforeEach(() => {
  h.excluded = [];
  h.toggleExcluded.mockReset();
  h.blockedReason.mockReset().mockReturnValue(null);
});

test("a bundled plugin is judged by its seeded source and the provider-wide sync state", () => {
  h.blockedReason.mockReturnValue("settings.plugins.sync.blocked.noChannel");
  const { result } = renderHook(() => usePluginSyncSwitch("b1", seeded));

  expect(h.blockedReason).toHaveBeenCalledWith("b1", "voltius", h.effective);
  expect(result.current.reason).toBe("settings.plugins.sync.blocked.noChannel");
});

test("a loaded plugin with no meta and no seeded artifact is local", () => {
  renderHook(() => usePluginSyncSwitch("dev", seeded));

  expect(h.blockedReason).toHaveBeenCalledWith("dev", "local", h.effective);
});

test("reflects the exclusion and toggles it", () => {
  h.excluded = ["b1"];
  const { result } = renderHook(() => usePluginSyncSwitch("b1", seeded));

  expect(result.current.synced).toBe(false);
  result.current.toggle();
  expect(h.toggleExcluded).toHaveBeenCalledWith("b1");
});
