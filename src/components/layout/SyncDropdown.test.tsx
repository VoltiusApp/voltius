import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import type { SyncProviderView } from "@/services/syncProviders";
import { NOT_CONFIGURED_SYNC_STATE } from "@/services/syncStatus";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@/hooks/useVaultContents", () => ({ useVaultContents: () => ({}) }));
vi.mock("@/components/shared/ContentCounts", () => ({ ContentCounts: () => null }));
const runAction = vi.hoisted(() => vi.fn());
vi.mock("@/services/syncProviderAction", () => ({ runSyncProviderAction: runAction }));
const available = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("@/hooks/useAvailableSyncProviders", () => ({
  useAvailableSyncProviders: () => ({ available: available.list, appVersion: "0.36.0" }),
}));

const lanRows = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("@/hooks/useLanDeviceRows", () => ({ useLanDeviceRows: () => lanRows.list }));
vi.mock("@/services/lanSync", () => ({ setLanSyncPaused: vi.fn(async () => {}) }));

import { SyncDropdown } from "./SyncDropdown";
import { useLanSyncStore } from "@/stores/lanSyncStore";

const view = (over: Partial<SyncProviderView>): SyncProviderView => ({
  id: "x", label: "X", icon: "lucide:cloud", availability: "active",
  state: { ...NOT_CONFIGURED_SYNC_STATE, status: "success", configured: true },
  syncNow: vi.fn(async () => {}), action: null, pauseToggle: null, ...over,
});

afterEach(() => {
  cleanup();
  runAction.mockReset();
  lanRows.list = [];
  useLanSyncStore.setState({ status: "stopped" });
});

describe("SyncDropdown", () => {
  const installer = { busy: new Set<string>(), startInstall: vi.fn() };

  test("renders one section per provider", () => {
    const { container } = render(
      <SyncDropdown anchorRef={createRef()} open onClose={() => {}} providers={[
        view({ id: "voltius", availability: "locked", syncNow: null, action: { kind: "signIn" } }),
        view({ id: "plugin-gist-sync" }),
        view({ id: "plugin-cloudflare-sync", availability: "not_configured", syncNow: null, action: { kind: "configure", pageId: "plugin-cloudflare-sync:settings" } }),
      ]} installer={installer} />,
    );
    expect([...container.querySelectorAll("[data-sync-provider]")].map((e) => e.getAttribute("data-sync-provider")))
      .toEqual(["voltius", "plugin-gist-sync", "plugin-cloudflare-sync"]);
  });

  test("an inactive provider's action closes the menu and runs the action", () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <SyncDropdown anchorRef={createRef()} open onClose={onClose} providers={[
        view({ id: "plugin-cloudflare-sync", availability: "disabled", syncNow: null, action: { kind: "enable" } }),
      ]} installer={installer} />,
    );
    fireEvent.click(getByText("layout.sync.enableArrow"));
    expect(onClose).toHaveBeenCalled();
    expect(runAction).toHaveBeenCalledWith({ kind: "enable" });
  });

  test("Sync now calls the provider's syncNow", () => {
    const syncNow = vi.fn(async () => {});
    const { getByText } = render(
      <SyncDropdown anchorRef={createRef()} open onClose={() => {}} providers={[view({ id: "plugin-gist-sync", syncNow })]} installer={installer} />,
    );
    fireEvent.click(getByText("layout.sync.syncNow"));
    expect(syncNow).toHaveBeenCalled();
  });

  test("a paused provider still syncs on demand and resumes from its row", () => {
    const syncNow = vi.fn(async () => {});
    const { getByText } = render(
      <SyncDropdown anchorRef={createRef()} open onClose={() => {}} providers={[
        view({ id: "voltius", availability: "paused", syncNow, action: { kind: "resume" } }),
      ]} installer={installer} />,
    );
    expect(getByText("layout.sync.paused")).toBeTruthy();
    fireEvent.click(getByText("layout.sync.syncNow"));
    expect(syncNow).toHaveBeenCalled();
    fireEvent.click(getByText("layout.sync.resumeArrow"));
    expect(runAction).toHaveBeenCalledWith({ kind: "resume" });
  });

  test("an unreachable provider says so and shows why", () => {
    const { getByText, queryByText } = render(
      <SyncDropdown anchorRef={createRef()} open onClose={() => {}} providers={[
        view({ id: "voltius", state: { ...NOT_CONFIGURED_SYNC_STATE, status: "offline", error: "connection refused", configured: true } }),
      ]} installer={installer} />,
    );
    expect(getByText("layout.sync.status.offline")).toBeTruthy();
    expect(getByText("connection refused")).toBeTruthy();
    expect(queryByText("layout.sync.status.error")).toBeNull();
  });

  test("the pause button pauses a syncing provider and leaves the menu open", () => {
    const onClose = vi.fn();
    const { getByTitle } = render(
      <SyncDropdown anchorRef={createRef()} open onClose={onClose} providers={[
        view({ id: "voltius", pauseToggle: { kind: "pause" } }),
      ]} installer={installer} />,
    );
    fireEvent.click(getByTitle("layout.sync.pause"));
    expect(runAction).toHaveBeenCalledWith({ kind: "pause" });
    expect(onClose).not.toHaveBeenCalled();
  });

  test("the same button resumes a paused provider", () => {
    const { getByTitle, queryByTitle } = render(
      <SyncDropdown anchorRef={createRef()} open onClose={() => {}} providers={[
        view({ id: "voltius", availability: "paused", action: { kind: "resume" }, pauseToggle: { kind: "resume" } }),
      ]} installer={installer} />,
    );
    expect(queryByTitle("layout.sync.pause")).toBeNull();
    fireEvent.click(getByTitle("layout.sync.resume"));
    expect(runAction).toHaveBeenCalledWith({ kind: "resume" });
  });

  test("a provider that cannot be paused shows no pause button", () => {
    const { queryByTitle } = render(
      <SyncDropdown anchorRef={createRef()} open onClose={() => {}} providers={[view({ id: "plugin-gist-sync" })]} installer={installer} />,
    );
    expect(queryByTitle("layout.sync.pause")).toBeNull();
    expect(queryByTitle("layout.sync.resume")).toBeNull();
  });

  test("lists uninstalled catalogue providers and installs through the shared installer", () => {
    const cloudflare = { id: "plugin-cloudflare-sync", name: "Cloudflare Sync", author: "a", description: "R2", repo: "", version: "0.4.0", tags: [], theme: false, sourceId: "voltius", permissions: ["sync:write"] };
    available.list = [cloudflare];
    const { container, getByText } = render(
      <SyncDropdown anchorRef={createRef()} open onClose={() => {}} providers={[view({ id: "voltius" })]} installer={installer} />,
    );
    expect(container.querySelector("[data-available-sync-provider='plugin-cloudflare-sync']")).not.toBeNull();
    fireEvent.click(getByText("settings.plugins.browse.install"));
    expect(installer.startInstall).toHaveBeenCalledWith(cloudflare);
    available.list = [];
  });

  test("the local network section comes first, above the providers", () => {
    useLanSyncStore.setState({ status: "running" });
    lanRows.list = [{ deviceId: "d1", name: "Desktop", platform: "linux", nearby: true, route: "lan", dot: "live", behind: 0, lastSeen: null }];
    const { container } = render(
      <SyncDropdown anchorRef={createRef()} open onClose={() => {}} providers={[view({ id: "voltius" })]} installer={installer} />,
    );
    const lan = container.querySelector("[data-lan-section]")!;
    expect(lan.compareDocumentPosition(container.querySelector("[data-sync-provider]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
