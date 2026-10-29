import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { SyncProviderView } from "@/services/syncProviders";
import type { DeviceRow } from "@/services/lanSyncDevices";
import { NOT_CONFIGURED_SYNC_STATE } from "@/services/syncStatus";

const h = vi.hoisted(() => ({
  providers: [] as unknown[],
  runAction: vi.fn(),
  closeSheet: vi.fn(),
  lanRows: [] as DeviceRow[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@/hooks/useSyncProviders", () => ({ useSyncProviders: () => ({ providers: h.providers }) }));
vi.mock("@/services/syncProviderAction", () => ({ runSyncProviderAction: h.runAction }));
vi.mock("@/hooks/useLanDeviceRows", () => ({ useLanDeviceRows: () => h.lanRows }));
vi.mock("@/services/lanSync", () => ({ setLanSyncPaused: vi.fn(async () => {}) }));
vi.mock("@/stores/mobileNavStore", () => ({
  // getState: BottomSheet registers a back interceptor, which reads the nav layer.
  useMobileNavStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) => sel({ closeSheet: h.closeSheet }),
    { getState: () => ({ tab: "hosts", stack: [], sheet: { kind: "sync" } }) },
  ),
}));

import SyncSheet from "./SyncSheet";
import { useLanSyncStore } from "@/stores/lanSyncStore";

const view = (over: Partial<SyncProviderView>): SyncProviderView => ({
  id: "voltius", label: "Voltius Sync", icon: "lucide:cloud", availability: "active",
  state: { ...NOT_CONFIGURED_SYNC_STATE, status: "success", configured: true },
  syncNow: vi.fn(async () => {}), action: null, pauseToggle: { kind: "pause" }, ...over,
});

const row = (slug: string) => document.querySelector<HTMLButtonElement>(`[data-sync-action='${slug}']`);

afterEach(() => { cleanup(); h.runAction.mockReset(); h.closeSheet.mockReset(); h.lanRows = []; useLanSyncStore.setState({ status: "stopped" }); });

describe("SyncSheet", () => {
  test("an active provider shows its status, syncs on demand and pauses without closing", () => {
    const syncNow = vi.fn(async () => {});
    h.providers = [view({ syncNow })];
    const { getByText } = render(<SyncSheet />);
    expect(getByText("layout.sync.status.synced")).toBeTruthy();
    fireEvent.click(row("sync-now")!);
    expect(syncNow).toHaveBeenCalled();
    fireEvent.click(row("pause")!);
    expect(h.runAction).toHaveBeenCalledWith({ kind: "pause" });
    expect(h.closeSheet).not.toHaveBeenCalled();
  });

  test("an unreachable server says so and shows why", () => {
    h.providers = [view({ state: { ...NOT_CONFIGURED_SYNC_STATE, status: "offline", error: "connection refused", configured: true } })];
    const { getByText } = render(<SyncSheet />);
    expect(getByText("layout.sync.status.offline")).toBeTruthy();
    expect(getByText("connection refused")).toBeTruthy();
  });

  test("a sync error shows its reason", () => {
    h.providers = [view({ state: { ...NOT_CONFIGURED_SYNC_STATE, status: "error", error: "Sync token is invalid", configured: true } })];
    const { getByText } = render(<SyncSheet />);
    expect(getByText("layout.sync.status.error")).toBeTruthy();
    expect(getByText("Sync token is invalid")).toBeTruthy();
  });

  test("a healthy sync shows no stale reason", () => {
    h.providers = [view({ state: { ...NOT_CONFIGURED_SYNC_STATE, status: "success", error: "old failure", configured: true } })];
    const { queryByText } = render(<SyncSheet />);
    expect(queryByText("old failure")).toBeNull();
  });

  test("a paused provider reads as paused, still syncs on demand and has one resume row", () => {
    const syncNow = vi.fn(async () => {});
    h.providers = [view({ availability: "paused", syncNow, action: { kind: "resume" }, pauseToggle: { kind: "resume" } })];
    const { getByText } = render(<SyncSheet />);
    expect(getByText("layout.sync.paused")).toBeTruthy();
    expect(row("pause")).toBeNull();
    expect(document.querySelectorAll("[data-sync-action='resume']")).toHaveLength(1);
    fireEvent.click(row("sync-now")!);
    expect(syncNow).toHaveBeenCalled();
    fireEvent.click(row("resume")!);
    expect(h.runAction).toHaveBeenCalledWith({ kind: "resume" });
    expect(h.closeSheet).not.toHaveBeenCalled();
  });

  test("a signed-out provider offers sign-in and closes the sheet", () => {
    h.providers = [view({ availability: "locked", syncNow: null, action: { kind: "signIn" }, pauseToggle: null })];
    render(<SyncSheet />);
    expect(row("sync-now")).toBeNull();
    fireEvent.click(row("signIn")!);
    expect(h.closeSheet).toHaveBeenCalled();
    expect(h.runAction).toHaveBeenCalledWith({ kind: "signIn" });
  });

  test("Sync now is disabled while a sync runs", () => {
    h.providers = [view({ state: { ...NOT_CONFIGURED_SYNC_STATE, status: "syncing", configured: true } })];
    render(<SyncSheet />);
    expect(row("sync-now")!.disabled).toBe(true);
  });

  test("renders one section per provider", () => {
    h.providers = [view({}), view({ id: "plugin-gist-sync", label: "Gist Sync", pauseToggle: null })];
    render(<SyncSheet />);
    expect([...document.querySelectorAll("[data-sync-provider]")].map((e) => e.getAttribute("data-sync-provider")))
      .toEqual(["voltius", "plugin-gist-sync"]);
  });

  test("sheet variant renders above provider sections with 44 px rows", () => {
    useLanSyncStore.setState({ status: "running", paused: false });
    h.lanRows = [
      { deviceId: "d1", name: "Desktop", platform: "linux", nearby: true, route: "lan", dot: "live", behind: 0, lastSeen: null },
      { deviceId: "d2", name: "MacBook", platform: "macos", nearby: false, route: null, dot: "offline-ok", behind: 0, lastSeen: null },
    ];
    h.providers = [view({})];
    render(<SyncSheet />);
    const lan = document.querySelector("[data-lan-section]")!;
    const provider = document.querySelector("[data-sync-provider]")!;
    expect(lan.compareDocumentPosition(provider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const rows = [...lan.querySelectorAll("[data-lan-device]")];
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.classList.contains("min-h-11")).toBe(true);
    expect(lan.querySelector("[data-lan-action='pause']")).not.toBeNull();
  });

  test("no local section while local sync is stopped with no known devices", () => {
    h.providers = [view({})];
    render(<SyncSheet />);
    expect(document.querySelector("[data-lan-section]")).toBeNull();
  });
});
