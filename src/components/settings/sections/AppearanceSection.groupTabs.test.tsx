import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import AppearanceSection from "./AppearanceSection";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    startDragging: vi.fn(),
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

beforeEach(() => useToggleSettingsStore.setState({ values: {} }));
afterEach(cleanup);

describe("Group tabs by host setting", () => {
  it("is on by default and turns off from the Appearance card", () => {
    render(<AppearanceSection />);
    const card = screen.getByText("settings.appearance.groupTabsByHost.title").closest("[class*='rounded-xl']")!;
    const toggle = card.querySelector("[role='switch']") as HTMLElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(useToggleSettingsStore.getState().values["group-tabs-by-host"]).toBe(false);
  });
});
