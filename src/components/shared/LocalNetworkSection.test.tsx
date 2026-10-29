import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { DeviceRow } from "@/services/lanSyncDevices";

const h = vi.hoisted(() => ({
  rows: [] as DeviceRow[],
  platform: "macos" as string | null,
  setPaused: vi.fn(async () => {}),
  openUrl: vi.fn(async () => {}),
  runAction: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o && Object.keys(o).length ? `${key}:${Object.values(o).join(",")}` : key),
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: h.openUrl }));
vi.mock("@/hooks/useLanDeviceRows", () => ({ useLanDeviceRows: () => h.rows }));
vi.mock("@/services/lanSync", () => ({ setLanSyncPaused: h.setPaused }));
vi.mock("@/services/syncProviderAction", () => ({ runSyncProviderAction: h.runAction }));
vi.mock("@/utils/platform", () => ({ usePlatform: () => h.platform }));
vi.mock("@/utils/localeFormat", () => ({ formatRelative: () => "2h ago" }));

import { LocalNetworkSection } from "./LocalNetworkSection";
import { useLanSyncStore } from "@/stores/lanSyncStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

const row = (over: Partial<DeviceRow>): DeviceRow => ({
  deviceId: "d1", name: "Desktop", platform: "linux", nearby: true, route: "lan", dot: "live", behind: 0, lastSeen: null, ...over,
});
const live = row({});
const phone = row({ deviceId: "d2", name: "Pixel 8", platform: "android", route: "tailscale" });
const behindMac = row({ deviceId: "d3", name: "MacBook", platform: "macos", nearby: false, route: null, dot: "behind", behind: 3, lastSeen: "2026-10-29T08:00:00Z" });
const okLaptop = row({ deviceId: "d4", name: "Work laptop", nearby: false, route: null, dot: "offline-ok", lastSeen: "2026-10-29T08:00:00Z" });

const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const device = (id: string) => q(`[data-lan-device='${id}']`)!;
const onClose = vi.fn();

beforeEach(() => {
  useLanSyncStore.setState({ status: "running", paused: false });
  useSubscriptionStore.setState({ isPro: false });
  h.platform = "macos";
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.rows = [];
});

describe("LocalNetworkSection", () => {
  test("live peers render with route text and green dot", () => {
    h.rows = [live, phone];
    const { getByText } = render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(getByText("layout.sync.local.status.live:2")).toBeTruthy();
    expect(device("d1").textContent).toContain("layout.sync.local.route.lan");
    expect(device("d2").textContent).toContain("layout.sync.local.route.tailscale");
    expect(device("d1").querySelector("[data-dot]")!.getAttribute("data-dot")).toBe("live");
    expect(device("d2").querySelector("[data-icon='lucide:smartphone']")).not.toBeNull();
  });

  test("a syncing peer names itself in the status line and shows its change count", () => {
    h.rows = [live, { ...phone, dot: "syncing", behind: 12 }];
    const { getByText } = render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(getByText("layout.sync.local.status.syncing:Pixel 8")).toBeTruthy();
    expect(device("d2").textContent).toContain("layout.sync.local.row.syncing:12");
  });

  test("offline devices sit below a divider and are dimmed", () => {
    h.rows = [live, behindMac, okLaptop];
    render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    const divider = q("[data-divider]")!;
    expect(divider).not.toBeNull();
    expect(device("d1").hasAttribute("data-offline")).toBe(false);
    for (const id of ["d3", "d4"]) {
      expect(device(id).hasAttribute("data-offline")).toBe(true);
      expect(divider.compareDocumentPosition(device(id)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(device(id).querySelector("span")!.style.color).toBe("var(--t-text-secondary)");
    }
    expect(device("d4").textContent).toContain("layout.sync.local.row.offlineOk");
    expect(device("d4").querySelector("[data-dot]")!.getAttribute("data-dot")).toBe("offline-ok");
  });

  test("behind device shows amber text and upsell for non-Pro", () => {
    h.rows = [live, behindMac];
    const { getByText } = render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    const text = getByText("layout.sync.local.row.behind:3");
    expect(text.style.color).toBe("var(--t-status-warning)");
    expect(device("d3").querySelector("[data-dot]")!.getAttribute("data-dot")).toBe("behind");
    expect(q("[data-lan-upsell]")!.textContent).toContain("layout.sync.local.upsell");
    fireEvent.click(getByText("layout.sync.local.upsellAction"));
    expect(h.runAction).toHaveBeenCalledWith({ kind: "upgrade" });
    expect(onClose).toHaveBeenCalled();
  });

  test("no upsell for Pro", () => {
    useSubscriptionStore.setState({ isPro: true });
    h.rows = [live, behindMac];
    render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(q("[data-lan-upsell]")).toBeNull();
  });

  test("no upsell when every device is up to date", () => {
    h.rows = [live, okLaptop];
    render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(q("[data-lan-upsell]")).toBeNull();
  });

  test("nothing nearby shows seen-when rows and catch-up line", () => {
    h.rows = [okLaptop, behindMac];
    const { getByText } = render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(getByText("layout.sync.local.status.none")).toBeTruthy();
    expect(device("d4").textContent).toContain("layout.sync.local.row.seenOk:2h ago");
    expect(device("d3").textContent).toContain("layout.sync.local.row.seenBehind:2h ago,3");
    expect(q("[data-divider]")).toBeNull();
    expect(getByText("layout.sync.local.catchUp")).toBeTruthy();
  });

  test("pause button toggles local sync", () => {
    h.rows = [live];
    const { getByLabelText, rerender } = render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    fireEvent.click(getByLabelText("layout.sync.local.pause"));
    expect(h.setPaused).toHaveBeenCalledWith(true);
    expect(onClose).not.toHaveBeenCalled();
    useLanSyncStore.setState({ paused: true });
    rerender(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(q("[data-lan-section]")!.textContent).toContain("layout.sync.local.status.paused");
    fireEvent.click(getByLabelText("layout.sync.local.resume"));
    expect(h.setPaused).toHaveBeenCalledWith(false);
  });

  test("blocked status shows the settings action", () => {
    useLanSyncStore.setState({ status: "blocked" });
    const { getByText } = render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(getByText("layout.sync.local.status.blocked")).toBeTruthy();
    fireEvent.click(getByText("layout.sync.local.openSettings"));
    expect(h.openUrl).toHaveBeenCalledWith("x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork");
  });

  test("blocked off macOS points at the firewall with no settings action", () => {
    h.platform = "windows";
    useLanSyncStore.setState({ status: "blocked" });
    const { getByText, queryByText } = render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(getByText("layout.sync.local.status.blockedOther")).toBeTruthy();
    expect(queryByText("layout.sync.local.openSettings")).toBeNull();
  });

  test("hidden when stopped with no known devices", () => {
    useLanSyncStore.setState({ status: "stopped" });
    render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(q("[data-lan-section]")).toBeNull();
  });

  test("sheet variant puts pause, settings and upgrade in tappable rows", () => {
    useLanSyncStore.setState({ status: "blocked" });
    h.rows = [behindMac];
    render(<LocalNetworkSection variant="sheet" onClose={onClose} />);
    const slugs = [...document.querySelectorAll("[data-lan-action]")].map((e) => e.getAttribute("data-lan-action"));
    expect(slugs).toEqual(["pause", "open-settings", "upgrade"]);
    fireEvent.click(q("[data-lan-action='pause']")!);
    expect(h.setPaused).toHaveBeenCalledWith(true);
  });
});
