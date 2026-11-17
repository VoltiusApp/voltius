import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncedPluginConsentStore } from "@/services/pluginSync";
import type { MarketplacePlugin } from "@/stores/marketplaceStore";

const h = vi.hoisted(() => ({
  resolve: vi.fn(),
  keepOff: vi.fn(async (_ids: string[]) => {}),
  fetchManifest: vi.fn(),
  installPlugin: vi.fn(async (..._args: unknown[]) => {}),
}));

const candidate = { id: "p1", name: "P1", repo: "o/p1", sourceId: "voltius" } as MarketplacePlugin;

vi.mock("@/components/settings/sections/PluginPermissionModal", () => ({
  PluginPermissionModal: (p: { pluginName: string; permissions: string[]; onConfirm: () => void; onCancel: () => void }) => (
    <div>
      <span>{`${p.pluginName}:${p.permissions.join(",")}`}</span>
      <button onClick={p.onConfirm}>confirm</button>
      <button onClick={p.onCancel}>cancel</button>
    </div>
  ),
}));
vi.mock("@/services/pluginSync", async () => {
  const { create } = await import("zustand");
  const useSyncedPluginConsentStore = create<{ queue: string[]; shift: () => void }>((set, get) => ({
    queue: [],
    shift: () => set({ queue: get().queue.slice(1) }),
  }));
  return { resolveSyncedCandidate: h.resolve, keepOffThisDevice: h.keepOff, useSyncedPluginConsentStore };
});
vi.mock("@/stores/marketplaceStore", () => ({
  useMarketplaceStore: { getState: () => ({ fetchManifest: h.fetchManifest, installPlugin: h.installPlugin }) },
}));

import { SyncedPluginConsentHost } from "./SyncedPluginConsentHost";

beforeEach(() => {
  useSyncedPluginConsentStore.setState({ queue: ["p1"] });
  h.resolve.mockReset().mockResolvedValue(candidate);
  h.keepOff.mockClear();
  h.installPlugin.mockClear();
  h.fetchManifest.mockReset().mockResolvedValue({
    manifest: { id: "p1", name: "Plugin One", version: "1.0.0", permissions: ["net"] },
    manifestText: "TEXT",
  });
});

afterEach(cleanup);

describe("SyncedPluginConsentHost", () => {
  it("renders nothing for an empty queue", () => {
    useSyncedPluginConsentStore.setState({ queue: [] });
    const { container } = render(<SyncedPluginConsentHost />);

    expect(container.innerHTML).toBe("");
  });

  it("shows the reviewed permissions for the queue head", async () => {
    render(<SyncedPluginConsentHost />);

    expect(await screen.findByText("Plugin One:net")).toBeTruthy();
    expect(h.fetchManifest).toHaveBeenCalledWith(candidate);
  });

  it("confirm installs the reviewed manifest sync-driven and dequeues", async () => {
    render(<SyncedPluginConsentHost />);
    await userEvent.click(await screen.findByText("confirm"));

    await waitFor(() => expect(useSyncedPluginConsentStore.getState().queue).toEqual([]));
    expect(h.installPlugin).toHaveBeenCalledWith(candidate, "TEXT", { syncDriven: true });
    expect(h.keepOff).not.toHaveBeenCalled();
  });

  it("cancel keeps the plugin off this device and dequeues", async () => {
    render(<SyncedPluginConsentHost />);
    await userEvent.click(await screen.findByText("cancel"));

    await waitFor(() => expect(useSyncedPluginConsentStore.getState().queue).toEqual([]));
    expect(h.keepOff).toHaveBeenCalledWith(["p1"]);
    expect(h.installPlugin).not.toHaveBeenCalled();
  });

  it("drops an unresolvable head so the queue is not stuck", async () => {
    h.resolve.mockResolvedValue(null);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<SyncedPluginConsentHost />);

    await waitFor(() => expect(useSyncedPluginConsentStore.getState().queue).toEqual([]));
    expect(h.installPlugin).not.toHaveBeenCalled();
  });
});
