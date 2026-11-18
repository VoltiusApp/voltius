// @vitest-environment jsdom
import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const os = vi.hoisted(() => ({ value: "ios" as string }));
vi.mock("@/utils/platform", async (orig) => ({
  ...(await orig<typeof import("@/utils/platform")>()),
  useIsAndroid: () => os.value === "android",
  useIsIOS: () => os.value === "ios",
  useIsMobile: () => os.value === "android" || os.value === "ios",
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => [] }));
vi.mock("@/hooks/useLocalShells", () => ({ useLocalShells: () => [] }));
vi.mock("@/hooks/useInstallablePlugins", () => ({
  useInstallablePlugins: () => ({ merged: [], taken: new Set(), appVersion: "1.0.0" }),
}));
vi.mock("@/services/launch", () => ({ launchHost: vi.fn(), launchQuickConnect: vi.fn(), launchLocalShell: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined), isTauri: () => false }));

import { useUIStore } from "@/stores/uiStore";
import OmniSearch from "./OmniSearch";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useUIStore.setState({ settingsOpen: false, settingsQuery: "", omniSeed: "Integrations" });
});
afterEach(cleanup);

test.each(["ios", "android"])("on %s the palette leaves out settings pages the phone hides", (platform) => {
  os.value = platform;
  render(<OmniSearch onClose={() => {}} />);
  expect(screen.queryByText("Integrations")).toBeNull();
});

test("on desktop the palette offers them", () => {
  os.value = "linux";
  render(<OmniSearch onClose={() => {}} />);
  expect(screen.getByText("Integrations")).toBeTruthy();
});
