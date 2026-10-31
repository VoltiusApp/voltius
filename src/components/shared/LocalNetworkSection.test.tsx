import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { DeviceRow } from "@/services/lanSyncDevices";

const h = vi.hoisted(() => ({
  rows: [] as DeviceRow[],
  platform: "macos" as string | null,
  setPaused: vi.fn(async () => {}),
  openUrl: vi.fn(async () => {}),
  runAction: vi.fn(),
  checkout: true,
  mode: "local-nopassword" as string | null,
  scope: null as { members?: string[] } | null,
  forget: vi.fn(async (_id: string) => {}),
  leave: vi.fn(async (_reason?: string) => {}),
  grouped: false,
  openDialog: vi.fn(),
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
vi.mock("@/services/lanSync", () => ({
  setLanSyncPaused: h.setPaused,
  lanScope: async () => h.scope,
  forgetDevice: h.forget,
  leaveLanGroup: h.leave,
  inLanGroup: async () => h.grouped,
}));
vi.mock("@/services/account", () => ({ getAccountMode: async () => h.mode }));
vi.mock("@/stores/pairDeviceDialogStore", () => ({ openPairDeviceDialog: h.openDialog }));
vi.mock("@/services/syncProviderAction", () => ({ runSyncProviderAction: h.runAction }));
vi.mock("@/utils/platform", async () => ({
  ...(await vi.importActual<typeof import("@/utils/platform")>("@/utils/platform")),
  usePlatform: () => h.platform,
}));
vi.mock("@/lib/haptics", () => ({ haptic: vi.fn() }));
vi.mock("@/utils/localeFormat", () => ({ formatRelative: () => "2h ago" }));
vi.mock("@/services/distribution", () => ({ get CAN_OPEN_CHECKOUT() { return h.checkout; } }));

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

const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const device = (id: string) => q(`[data-lan-device='${id}']`)!;
const onClose = vi.fn();

beforeEach(() => {
  useLanSyncStore.setState({ status: "running", paused: false });
  useSubscriptionStore.setState({ tier: "free", isPro: false, seatTeam: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.rows = [];
  h.platform = "macos";
  h.checkout = true;
  h.mode = "local-nopassword";
  h.scope = null;
  h.grouped = false;
  useLanSyncStore.setState({ status: "stopped", paused: false });
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
    fireEvent.click(getByText("layout.sync.upgradeArrow"));
    expect(h.runAction).toHaveBeenCalledWith({ kind: "upgrade" });
    expect(onClose).toHaveBeenCalled();
  });

  test("no upsell for Pro", () => {
    useSubscriptionStore.setState({ tier: "pro", isPro: true });
    h.rows = [live, behindMac];
    render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(q("[data-lan-upsell]")).toBeNull();
  });

  test("no upsell for a seat member", () => {
    useSubscriptionStore.setState({ tier: "teams", isPro: true, billingTier: "free", seatTeam: { id: "t1", trial: false } });
    h.rows = [live, behindMac];
    render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(q("[data-lan-upsell]")).toBeNull();
  });

  test.each(["dropdown", "sheet"] as const)("store builds show no upsell in the %s", (variant) => {
    h.checkout = false;
    h.rows = [live, behindMac];
    render(<LocalNetworkSection variant={variant} onClose={onClose} />);
    expect(q("[data-lan-upsell]")).toBeNull();
    expect(q("[data-lan-action='upgrade']")).toBeNull();
    expect(document.body.textContent).not.toContain("layout.sync.upgradeArrow");
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

  test.each([
    ["windows", "layout.sync.local.status.blockedOther"],
    ["android", "layout.sync.local.status.blockedNetwork"],
    ["linux", "layout.sync.local.status.blockedNetwork"],
    ["ios", "layout.sync.local.status.blockedNetwork"],
  ])("blocked on %s shows its own copy with no settings action", (platform, key) => {
    h.platform = platform;
    useLanSyncStore.setState({ status: "blocked" });
    const { getByText, queryByText } = render(<LocalNetworkSection variant="sheet" onClose={onClose} />);
    expect(getByText(key)).toBeTruthy();
    expect(queryByText("layout.sync.local.openSettings")).toBeNull();
    expect(q("[data-lan-action='open-settings']")).toBeNull();
  });

  test("a listed peer outranks a blocked status", () => {
    useLanSyncStore.setState({ status: "blocked" });
    h.rows = [live, behindMac];
    const { getByText, queryByText } = render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(getByText("layout.sync.local.status.live:1")).toBeTruthy();
    expect(queryByText("layout.sync.local.status.blocked")).toBeNull();
    expect(queryByText("layout.sync.local.openSettings")).toBeNull();
    expect(q("[data-lan-upsell]")).not.toBeNull();
  });

  test("paused beats blocked and dims the list", () => {
    useLanSyncStore.setState({ status: "blocked", paused: true });
    h.rows = [live];
    const { getByText, queryByText } = render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(getByText("layout.sync.local.status.paused")).toBeTruthy();
    expect(queryByText("layout.sync.local.status.blocked")).toBeNull();
    expect(queryByText("layout.sync.local.openSettings")).toBeNull();
    expect(device("d1").parentElement!.style.opacity).toBe("0.6");
  });

  test("a paused status without the flag still offers resume", () => {
    useLanSyncStore.setState({ status: "paused", paused: false });
    h.rows = [live];
    const { getByLabelText } = render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    fireEvent.click(getByLabelText("layout.sync.local.resume"));
    expect(h.setPaused).toHaveBeenCalledWith(false);
  });

  test.each([
    ["paused", { status: "running", paused: true }],
    ["blocked", { status: "blocked", paused: false }],
    ["stopped", { status: "stopped", paused: false }],
  ] as const)("no catch-up line or upsell while %s", (_name, state) => {
    useLanSyncStore.setState(state);
    h.rows = [okLaptop, behindMac];
    const { queryByText } = render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(q("[data-lan-section]")).not.toBeNull();
    expect(queryByText("layout.sync.local.catchUp")).toBeNull();
    expect(q("[data-lan-upsell]")).toBeNull();
  });

  test("a key-changed row never shows the cloud upsell", () => {
    h.rows = [live, row({ deviceId: "k1", name: "Changed", nearby: false, route: null, dot: "alert", flag: "keyChanged" })];
    render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(q("[data-lan-upsell]")).toBeNull();
    expect(device("k1").querySelector("[data-dot]")!.getAttribute("data-dot")).toBe("alert");
  });

  test("a paused nearby peer is not counted as live", () => {
    h.rows = [live, row({ deviceId: "p1", name: "Paused", dot: "offline-ok", flag: "paused" })];
    const { getByText } = render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(getByText("layout.sync.local.status.live:1")).toBeTruthy();
  });

  test("hidden when stopped with no known devices", () => {
    useLanSyncStore.setState({ status: "stopped" });
    render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
    expect(q("[data-lan-section]")).toBeNull();
  });

  test("sheet variant puts pause, settings and upgrade in tappable rows", () => {
    const slugs = () => [...document.querySelectorAll("[data-lan-action]")].map((e) => e.getAttribute("data-lan-action"));
    h.rows = [behindMac];
    const { rerender } = render(<LocalNetworkSection variant="sheet" onClose={onClose} />);
    expect(slugs()).toEqual(["pause", "upgrade"]);
    fireEvent.click(q("[data-lan-action='upgrade']")!);
    expect(h.runAction).toHaveBeenCalledWith({ kind: "upgrade" });
    useLanSyncStore.setState({ status: "blocked" });
    rerender(<LocalNetworkSection variant="sheet" onClose={onClose} />);
    expect(slugs()).toEqual(["pause", "open-settings"]);
    fireEvent.click(q("[data-lan-action='open-settings']")!);
    expect(h.openUrl).toHaveBeenCalled();
    fireEvent.click(q("[data-lan-action='pause']")!);
    expect(h.setPaused).toHaveBeenCalledWith(true);
  });

  describe("pairing and forgetting", () => {
    const flagged = (flag: DeviceRow["flag"], over: Partial<DeviceRow> = {}) =>
      row({ deviceId: "f1", name: "Flagged", nearby: false, route: null, dot: "offline-ok", flag, ...over });

    test.each(["local", "local-nopassword"])("a %s install offers Pair a device", async (mode) => {
      h.mode = mode;
      h.rows = [live];
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      await waitFor(() => expect(q("[data-inline-action='pair']")).not.toBeNull());
    });

    test("iOS never offers Pair and keeps a stopped, empty section hidden", async () => {
      h.platform = "ios";
      h.rows = [live];
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      await new Promise((r) => setTimeout(r, 10));
      expect(q("[data-inline-action='pair']")).toBeNull();
      cleanup();
      h.rows = [];
      useLanSyncStore.setState({ status: "stopped" });
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      await new Promise((r) => setTimeout(r, 10));
      expect(q("[data-lan-section]")).toBeNull();
    });

    test.each(["server", null])("a %s install never offers Pair a device", async (mode) => {
      h.mode = mode;
      h.rows = [live];
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      await new Promise((r) => setTimeout(r, 10));
      expect(q("[data-inline-action='pair']")).toBeNull();
    });

    test("an unpaired no-account install shows the section with zero rows and the manager stopped", async () => {
      useLanSyncStore.setState({ status: "stopped" });
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      await waitFor(() => expect(q("[data-lan-section]")).not.toBeNull());
      expect(q("[data-inline-action='pair']")).not.toBeNull();
    });

    test("dropdown Pair closes the menu and opens the dialog", async () => {
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      await waitFor(() => expect(q("[data-inline-action='pair']")).not.toBeNull());
      fireEvent.click(q("[data-inline-action='pair']")!);
      expect(onClose).toHaveBeenCalled();
      expect(h.openDialog).toHaveBeenCalled();
    });

    test("sheet Pair is a sheet action row that calls onPair", async () => {
      const onPair = vi.fn();
      render(<LocalNetworkSection variant="sheet" onClose={onClose} onPair={onPair} />);
      await waitFor(() => expect(q("[data-lan-action='pair']")).not.toBeNull());
      fireEvent.click(q("[data-lan-action='pair']")!);
      expect(onPair).toHaveBeenCalled();
      expect(h.openDialog).not.toHaveBeenCalled();
    });

    test.each([
      ["paused", "layout.sync.local.row.paused"],
      ["keyChanged", "layout.sync.local.row.keyChanged"],
      ["moved", "layout.sync.local.row.moved"],
    ] as const)("a %s row shows its copy", async (flag, copy) => {
      h.rows = [flagged(flag)];
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      await waitFor(() => expect(device("f1").textContent).toContain(copy));
    });

    test("a flagged row keeps room for the device name and wraps its note", () => {
      h.rows = [flagged("moved", { name: "laptop-of-a-long-name" })];
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      const [name, note] = [...device("f1").querySelectorAll("span")];
      expect(name.className).toContain("min-w-[35%]");
      expect(note.className).toContain("min-w-0");
      expect(note.className).not.toContain("truncate");
    });

    test("keyChanged text is amber, paused and moved are muted", () => {
      h.rows = [flagged("keyChanged", { dot: "alert" }), flagged("paused", { deviceId: "f2" }), flagged("moved", { deviceId: "f3" })];
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      const color = (id: string) => device(id).querySelectorAll("span")[1].style.color;
      expect(color("f1")).toBe("var(--t-status-warning)");
      expect(color("f2")).toBe("var(--t-text-dim)");
      expect(color("f3")).toBe("var(--t-text-dim)");
    });

    test.each([
      [{ members: ["k1"] }, "layout.sync.local.forget.group:Flagged"],
      [null, "layout.sync.local.forget.account:Flagged"],
    ])("forget copy follows the scope %j", async (scope, copy) => {
      h.scope = scope;
      h.rows = [flagged("paused")];
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      fireEvent.click(q("[data-lan-forget='f1']")!);
      await waitFor(() => expect(q("[data-lan-forget-confirm]")!.textContent).toContain(copy));
    });

    test("confirming forgets the device and closes the prompt", async () => {
      h.rows = [flagged("paused")];
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      fireEvent.click(q("[data-lan-forget='f1']")!);
      await waitFor(() => expect(q("[data-inline-action='forget-confirm']")).not.toBeNull());
      fireEvent.click(q("[data-inline-action='forget-confirm']")!);
      await waitFor(() => expect(h.forget).toHaveBeenCalledWith("f1"));
      await waitFor(() => expect(q("[data-lan-forget-confirm]")).toBeNull());
    });

    test("a failed forget shows an error and keeps the prompt", async () => {
      h.forget.mockRejectedValueOnce(new Error("boom"));
      h.rows = [flagged("paused")];
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      fireEvent.click(q("[data-lan-forget='f1']")!);
      await waitFor(() => expect(q("[data-inline-action='forget-confirm']")).not.toBeNull());
      fireEvent.click(q("[data-inline-action='forget-confirm']")!);
      await waitFor(() => expect(q("[data-lan-forget-error]")!.textContent).toContain("layout.sync.local.forget.failed:Flagged"));
      expect(q("[data-lan-forget-confirm]")).not.toBeNull();
    });

    test("forgetting a key-changed device warns and never calls it safe", async () => {
      h.rows = [flagged("keyChanged")];
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      fireEvent.click(q("[data-lan-forget='f1']")!);
      await waitFor(() => expect(q("[data-lan-forget-confirm]")).not.toBeNull());
      expect(q("[data-lan-forget-confirm]")!.textContent).toContain("layout.sync.local.forget.keyChanged");
      expect(q("[data-lan-forget-confirm]")!.textContent).not.toMatch(/safe/i);
    });

    test("cancel dismisses the prompt without forgetting", async () => {
      h.rows = [flagged("paused")];
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      fireEvent.click(q("[data-lan-forget='f1']")!);
      await waitFor(() => expect(q("[data-inline-action='forget-cancel']")).not.toBeNull());
      fireEvent.click(q("[data-inline-action='forget-cancel']")!);
      expect(q("[data-lan-forget-confirm]")).toBeNull();
      expect(h.forget).not.toHaveBeenCalled();
    });

    test("sheet Forget uses sheet action rows", async () => {
      h.rows = [flagged("moved")];
      render(<LocalNetworkSection variant="sheet" onClose={onClose} onPair={vi.fn()} />);
      fireEvent.click(q("[data-lan-forget='f1']")!);
      await waitFor(() => expect(q<HTMLButtonElement>("[data-lan-action='forget-confirm']")?.disabled).toBe(false));
      fireEvent.click(q("[data-lan-action='forget-confirm']")!);
      await waitFor(() => expect(h.forget).toHaveBeenCalledWith("f1"));
    });

    test.each(["dropdown", "sheet"] as const)("no upgrade link in any new state in the %s with checkout off", async (variant) => {
      h.checkout = false;
      h.rows = [flagged("keyChanged"), flagged("paused", { deviceId: "f2" }), flagged("moved", { deviceId: "f3" })];
      render(<LocalNetworkSection variant={variant} onClose={onClose} onPair={vi.fn()} />);
      fireEvent.click(q("[data-lan-forget='f1']")!);
      await waitFor(() => expect(q("[data-lan-forget-confirm]")).not.toBeNull());
      expect(q("[data-lan-upsell]")).toBeNull();
      expect(q("[data-lan-action='upgrade']")).toBeNull();
      expect(document.body.textContent).not.toMatch(/upgrade|upsell/i);
    });
  });

  describe("leaving the group", () => {
    const settle = () => new Promise((r) => setTimeout(r, 10));

    test("a grouped no-account install offers Leave, asks first, then leaves and closes the menu", async () => {
      h.grouped = true;
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      await waitFor(() => expect(q("[data-inline-action='leave']")).not.toBeNull());
      expect(q("[data-inline-action='leave']")!.textContent).toBe("layout.sync.local.leave.label");
      fireEvent.click(q("[data-inline-action='leave']")!);
      expect(h.leave).not.toHaveBeenCalled();
      expect(q("[data-lan-leave-confirm]")!.textContent).toContain("layout.sync.local.leave.prompt");
      fireEvent.click(q("[data-inline-action='leave-confirm']")!);
      await waitFor(() => expect(h.leave).toHaveBeenCalledWith("left"));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    test("the sheet offers Leave as a sheet action row with the same prompt", async () => {
      h.grouped = true;
      render(<LocalNetworkSection variant="sheet" onClose={onClose} onPair={vi.fn()} />);
      await waitFor(() => expect(q("[data-lan-action='leave']")).not.toBeNull());
      fireEvent.click(q("[data-lan-action='leave']")!);
      fireEvent.click(q("[data-lan-action='leave-confirm']")!);
      await waitFor(() => expect(h.leave).toHaveBeenCalledWith("left"));
    });

    test.each([
      ["an ungrouped no-account install", "local-nopassword", false, "linux"],
      ["a signed-in install", "server", true, "linux"],
      ["iOS", "local-nopassword", true, "ios"],
    ])("%s never offers Leave", async (_case, mode, grouped, platform) => {
      h.mode = mode;
      h.grouped = grouped;
      h.platform = platform;
      h.rows = [live];
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      await settle();
      expect(q("[data-inline-action='leave']")).toBeNull();
    });

    test("cancel keeps the group", async () => {
      h.grouped = true;
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      await waitFor(() => expect(q("[data-inline-action='leave']")).not.toBeNull());
      fireEvent.click(q("[data-inline-action='leave']")!);
      fireEvent.click(q("[data-inline-action='leave-cancel']")!);
      expect(q("[data-lan-leave-confirm]")).toBeNull();
      expect(h.leave).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    test("a failed leave says so and keeps the prompt", async () => {
      h.grouped = true;
      h.leave.mockRejectedValueOnce(new Error("boom"));
      render(<LocalNetworkSection variant="dropdown" onClose={onClose} />);
      await waitFor(() => expect(q("[data-inline-action='leave']")).not.toBeNull());
      fireEvent.click(q("[data-inline-action='leave']")!);
      fireEvent.click(q("[data-inline-action='leave-confirm']")!);
      await waitFor(() => expect(q("[data-lan-leave-error]")!.textContent).toBe("layout.sync.local.leave.failed"));
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
