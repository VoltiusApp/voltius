import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useLanSyncStore } from "@/stores/lanSyncStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));

afterEach(() => {
  cleanup();
  useSyncPrefsStore.setState({ paused: false });
  useLanSyncStore.setState({ peers: [], paused: false });
  useSubscriptionStore.setState({ accountMode: null, isPro: false });
  useMobileNavStore.setState({ sheet: null });
});

// Task 9: the notification bell must reach mobile, not just TitleBar. This is the
// header shown on the hosts/snippets/more tabs.
describe("MobileHeader", () => {
  test("mounts the notification bell in its trailing slot", async () => {
    const { default: MobileHeader } = await import("./MobileHeader");
    const { container } = render(<MobileHeader />);
    expect(container.querySelector('[title="notifications.bell.title"]')).not.toBeNull();
  });

  test("the sync icon is a button that opens the sync sheet", async () => {
    useSubscriptionStore.setState({ accountMode: "server", isPro: true });
    const { default: MobileHeader } = await import("./MobileHeader");
    const { container } = render(<MobileHeader />);
    const button = container.querySelector<HTMLButtonElement>("button[data-mobile-sync-status]")!;
    expect(button.getAttribute("aria-label")).toBe("layout.sync.status.default");
    fireEvent.click(button);
    expect(useMobileNavStore.getState().sheet).toEqual({ kind: "sync" });
  });

  test("a paused device keeps the icon, as a pause mark", async () => {
    useSubscriptionStore.setState({ accountMode: "server", isPro: true });
    useSyncPrefsStore.setState({ paused: true });
    const { default: MobileHeader } = await import("./MobileHeader");
    const { container } = render(<MobileHeader />);
    const button = container.querySelector("button[data-mobile-sync-status]")!;
    expect(button.getAttribute("aria-label")).toBe("layout.sync.status.paused");
    expect(button.querySelector("[data-icon='lucide:circle-pause']")).not.toBeNull();
  });

  test("a device with sync off but peers nearby shows the wifi icon", async () => {
    useLanSyncStore.setState({ peers: [{ deviceId: "A", deviceName: "A", platform: "linux", route: "lan", address: "a" }] });
    const { default: MobileHeader } = await import("./MobileHeader");
    const { container } = render(<MobileHeader />);
    const button = container.querySelector("button[data-mobile-sync-status]")!;
    expect(button.getAttribute("aria-label")).toBe("layout.sync.local.tooltip");
    expect(button.querySelector("[data-icon='lucide:wifi']")).not.toBeNull();
  });

  test("paused local sync does not count its peers as nearby", async () => {
    useLanSyncStore.setState({ paused: true, peers: [{ deviceId: "A", deviceName: "A", platform: "linux", route: "lan", address: "a" }] });
    const { default: MobileHeader } = await import("./MobileHeader");
    const { container } = render(<MobileHeader />);
    const button = container.querySelector("button[data-mobile-sync-status]")!;
    expect(button.getAttribute("aria-label")).not.toBe("layout.sync.local.tooltip");
  });

  test("a device that never set sync up still shows the sync button", async () => {
    const { default: MobileHeader } = await import("./MobileHeader");
    const { container } = render(<MobileHeader />);
    const button = container.querySelector<HTMLButtonElement>("button[data-mobile-sync-status]")!;
    expect(button.getAttribute("aria-label")).toBe("layout.sync.status.notConfigured");
    fireEvent.click(button);
    expect(useMobileNavStore.getState().sheet).toEqual({ kind: "sync" });
  });
});
