import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { usePolicyStore } from "@/stores/policyStore";
import { useThemeStore } from "@/stores/themeStore";
import { useLocaleStore } from "@/stores/localeStore";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), startDragging: vi.fn() }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import AppearanceSection from "./AppearanceSection";
import OmniThemeAutomation from "@/components/omni/OmniThemeAutomation";

const NONE = { policy: {}, defaults: {} };
const policy = (p: Record<string, unknown>) => usePolicyStore.setState({ machine: { policy: p, defaults: {} }, server: NONE });

beforeEach(() => {
  usePolicyStore.setState({ machine: NONE, server: NONE });
  useThemeStore.setState({ mode: "sunset", location: null });
  useLocaleStore.setState({ locale: "en" });
});
afterEach(cleanup);

test.each([
  ["settings", () => <AppearanceSection />, "settings.appearance.automation"],
  ["omni", () => <OmniThemeAutomation onBack={() => {}} onClose={() => {}} />, "omni.theme"],
])("location lock hides use-my-location (%s)", (_name, ui, prefix) => {
  policy({ "themes.location": { lat: 48.85, lng: 2.35 } });
  render(ui());
  expect(screen.queryByText(`${prefix}.useMyLocation`)).toBeNull();
  const lat = screen.getByPlaceholderText(`${prefix}.latitude`) as HTMLInputElement;
  expect(lat.value).toBe("48.85");
  expect(lat.matches(":disabled")).toBe(true);
  expect((screen.getByPlaceholderText(`${prefix}.longitude`) as HTMLInputElement).matches(":disabled")).toBe(true);
});

test.each([
  ["settings", () => <AppearanceSection />, "settings.appearance.automation"],
  ["omni", () => <OmniThemeAutomation onBack={() => {}} onClose={() => {}} />, "omni.theme"],
])("without a lock the location stays editable (%s)", (_name, ui, prefix) => {
  render(ui());
  expect(screen.getByText(`${prefix}.useMyLocation`)).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText(`${prefix}.latitude`), { target: { value: "10" } });
  fireEvent.change(screen.getByPlaceholderText(`${prefix}.longitude`), { target: { value: "20" } });
  expect(useThemeStore.getState().location).toMatchObject({ lat: 10, lng: 20, source: "manual" });
});

test("language options outside the allowed list are disabled", () => {
  policy({ "appSettings.locale": { $range: { allowed: ["en", "fr"] } } });
  render(<AppearanceSection />);
  expect(screen.getByText('common.policy.rangeAllowed {"values":"English, Français"}')).toBeTruthy();
  const row = screen.getByText("settings.appearance.language.title").closest("[class*='rounded-xl']") as HTMLElement;
  fireEvent.click(row.querySelector("[data-form-select]")!);
  const option = (label: string) => screen.getAllByText(label).slice(-1)[0].closest("button")!;
  expect(option("Français").matches(":disabled")).toBe(false);
  expect(option("Русский").matches(":disabled")).toBe(true);
});
