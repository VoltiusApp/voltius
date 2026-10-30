import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { MyDevice } from "@/services/myDevices";

const h = vi.hoisted(() => ({
  devices: [] as MyDevice[],
  openUrl: vi.fn(async () => {}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o && Object.keys(o).length ? `${key}:${Object.values(o).join(",")}` : key),
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: h.openUrl }));
vi.mock("@/services/myDevices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/myDevices")>()),
  useMyDevices: () => h.devices,
}));
vi.mock("@/utils/platform", () => ({ usePlatform: () => "macos" }));
vi.mock("@/utils/localeFormat", () => ({ formatRelative: () => "2 h ago" }));

import { MyDevicesGroup } from "./MyDevicesGroup";
import { useLanSyncStore } from "@/stores/lanSyncStore";

const device = (over: Partial<MyDevice>): MyDevice => ({
  deviceId: "d1", deviceKey: "k1", name: "Desktop-PC", platform: "linux", state: "ready", route: "lan", lastSeen: null, ...over,
});
const desktop = device({});
const server = device({ deviceId: "d2", name: "Home server", route: "tailscale" });
const office = device({ deviceId: "d5", name: "Office NUC", route: "vpn" });
const laptop = device({ deviceId: "d3", name: "Work laptop", state: "off" });
const mac = device({ deviceId: "d4", name: "MacBook Air", platform: "macos", state: "offline", route: null, lastSeen: "2026-10-29T08:00:00Z" });

const row = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(name))!;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.devices = [];
  useLanSyncStore.setState({ status: "stopped" });
});

describe("MyDevicesGroup", () => {
  test("renders each state with its subtitle", () => {
    h.devices = [desktop, server, office, laptop, mac];
    const { getByText } = render(<MyDevicesGroup density="compact" onPick={() => {}} />);
    expect(getByText("fileTransfer.myDevices.title")).toBeTruthy();
    expect(row("Desktop-PC").textContent).toContain("layout.sync.local.route.lan");
    expect(row("Home server").textContent).toContain("layout.sync.local.route.tailscale");
    expect(row("Office NUC").textContent).toContain("layout.sync.local.route.vpn");
    expect(row("Work laptop").textContent).toContain("fileTransfer.myDevices.fileAccessOff");
    expect(row("Work laptop").querySelector("[data-icon='lucide:lock']")).toBeTruthy();
    expect(row("MacBook Air").textContent).toContain("fileTransfer.myDevices.offlineSeen:2 h ago");
  });

  test("a ready row picks the device; off and offline rows are disabled", () => {
    h.devices = [desktop, laptop, mac];
    const onPick = vi.fn();
    render(<MyDevicesGroup density="compact" onPick={onPick} />);
    fireEvent.click(row("Work laptop"));
    fireEvent.click(row("MacBook Air"));
    expect(onPick).not.toHaveBeenCalled();
    expect(row("Work laptop").disabled).toBe(true);
    expect(row("MacBook Air").disabled).toBe(true);
    fireEvent.click(row("Desktop-PC"));
    expect(onPick).toHaveBeenCalledWith(desktop);
  });

  test("renders nothing without devices", () => {
    const { container } = render(<MyDevicesGroup density="compact" onPick={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  test("a blocked local network shows the fix-it line instead of the rows", () => {
    h.devices = [desktop];
    useLanSyncStore.setState({ status: "blocked" });
    const { getByText, queryByText } = render(<MyDevicesGroup density="compact" onPick={() => {}} />);
    expect(getByText("layout.sync.local.status.blocked")).toBeTruthy();
    expect(queryByText("Desktop-PC")).toBeNull();
    fireEvent.click(getByText("layout.sync.local.openSettings"));
    expect(h.openUrl).toHaveBeenCalledOnce();
  });

  test("blocked with no known devices still shows the fix-it line", () => {
    useLanSyncStore.setState({ status: "blocked" });
    const { getByText } = render(<MyDevicesGroup density="compact" query="nothing matches" onPick={() => {}} />);
    expect(getByText("fileTransfer.myDevices.title")).toBeTruthy();
    expect(getByText("layout.sync.local.status.blocked")).toBeTruthy();
  });
});
