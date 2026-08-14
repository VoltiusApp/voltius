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

// Task 9: the notification bell must reach mobile, not just TitleBar. This is the
// header shown on the hosts/snippets/more tabs.
describe("MobileHeader", () => {
  test("mounts the notification bell in its trailing slot", async () => {
    const { default: MobileHeader } = await import("./MobileHeader");
    const { container } = render(<MobileHeader />);
    expect(container.querySelector('[title="notifications.bell.title"]')).not.toBeNull();
  });
});
