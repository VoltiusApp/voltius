import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

afterEach(cleanup);

// Task 9: this is the persistent terminal-tab chrome — the case the notification-bell
// mobile gap matters most for, since a teammate blocked on a control request is sitting
// in an active session, not on the hosts/snippets/more tabs.
describe("MobileTerminalTopBar", () => {
  test("mounts the notification bell alongside its existing trailing icons", async () => {
    const { default: MobileTerminalTopBar } = await import("./MobileTerminalTopBar");
    const { container } = render(<MobileTerminalTopBar />);
    expect(container.querySelector('[title="notifications.bell.title"]')).not.toBeNull();
  });
});
