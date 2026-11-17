import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncedPluginConsentStore, type ConsentRequest } from "@/services/pluginSync";
import type { MarketplacePlugin } from "@/stores/marketplaceStore";

const h = vi.hoisted(() => ({
  resolve: vi.fn(),
  wanted: vi.fn((_r: unknown) => true),
  keepOff: vi.fn(async (_ids: string[]) => {}),
  fetchManifest: vi.fn(),
  installPlugin: vi.fn(async (..._args: unknown[]) => {}),
  notifyError: vi.fn(),
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
vi.mock("@/components/settings/usePluginInstaller", () => ({ notifyInstallError: h.notifyError }));
vi.mock("@/services/pluginSync", async () => {
  const { create } = await import("zustand");
  const useSyncedPluginConsentStore = create<{ queue: ConsentRequest[]; shift: () => void }>((set, get) => ({
    queue: [],
    shift: () => set({ queue: get().queue.slice(1) }),
  }));
  return {
    resolveSyncedCandidate: h.resolve,
    consentStillWanted: h.wanted,
    keepOffThisDevice: h.keepOff,
    useSyncedPluginConsentStore,
  };
});
vi.mock("@/stores/marketplaceStore", () => ({
  useMarketplaceStore: { getState: () => ({ fetchManifest: h.fetchManifest, installPlugin: h.installPlugin }) },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { SyncedPluginConsentHost } from "./SyncedPluginConsentHost";

const queue = () => useSyncedPluginConsentStore.getState().queue;

beforeEach(() => {
  useSyncedPluginConsentStore.setState({ queue: [{ id: "p1", keep: false }] });
  h.resolve.mockReset().mockResolvedValue(candidate);
  h.wanted.mockReset().mockReturnValue(true);
  h.keepOff.mockClear();
  h.installPlugin.mockReset().mockResolvedValue(undefined);
  h.notifyError.mockReset();
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

    await waitFor(() => expect(queue()).toEqual([]));
    expect(h.installPlugin).toHaveBeenCalledWith(candidate, "TEXT", { syncDriven: true });
    expect(h.keepOff).not.toHaveBeenCalled();
    expect(h.notifyError).not.toHaveBeenCalled();
  });

  it("a failed install after confirm raises an error toast and still dequeues", async () => {
    const error = new Error("HTTP 404");
    h.installPlugin.mockRejectedValue(error);
    render(<SyncedPluginConsentHost />);
    await userEvent.click(await screen.findByText("confirm"));

    await waitFor(() => expect(queue()).toEqual([]));
    expect(h.notifyError).toHaveBeenCalledWith(error, expect.any(Function));
  });

  it("cancel keeps the plugin off this device and dequeues", async () => {
    render(<SyncedPluginConsentHost />);
    await userEvent.click(await screen.findByText("cancel"));

    await waitFor(() => expect(queue()).toEqual([]));
    expect(h.keepOff).toHaveBeenCalledWith(["p1"]);
    expect(h.installPlugin).not.toHaveBeenCalled();
  });

  it("cancelling a kept plugin leaves it as it is", async () => {
    useSyncedPluginConsentStore.setState({ queue: [{ id: "p1", keep: true }] });
    render(<SyncedPluginConsentHost />);
    await userEvent.click(await screen.findByText("cancel"));

    await waitFor(() => expect(queue()).toEqual([]));
    expect(h.keepOff).not.toHaveBeenCalled();
    expect(h.installPlugin).not.toHaveBeenCalled();
  });

  it("silently drops a head that is no longer wanted", async () => {
    h.wanted.mockImplementation((r) => (r as ConsentRequest).id !== "gone");
    useSyncedPluginConsentStore.setState({ queue: [{ id: "gone", keep: false }, { id: "p1", keep: false }] });
    render(<SyncedPluginConsentHost />);

    expect(await screen.findByText("Plugin One:net")).toBeTruthy();
    expect(queue()).toEqual([{ id: "p1", keep: false }]);
    expect(h.resolve).toHaveBeenCalledTimes(1);
    expect(h.resolve).toHaveBeenCalledWith("p1");
  });

  it("drops an unresolvable head so the queue is not stuck", async () => {
    h.resolve.mockResolvedValue(null);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<SyncedPluginConsentHost />);

    await waitFor(() => expect(queue()).toEqual([]));
    expect(h.installPlugin).not.toHaveBeenCalled();
  });
});
