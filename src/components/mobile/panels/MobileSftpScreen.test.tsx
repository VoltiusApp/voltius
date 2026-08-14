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

describe("MobileSftpScreen", () => {
  test("mounts the notification bell in the panel header's right slot", async () => {
    const { default: MobileSftpScreen } = await import("./MobileSftpScreen");
    const { container } = render(<MobileSftpScreen asTab />);
    expect(container.querySelector('[title="notifications.bell.title"]')).not.toBeNull();
  });
});
