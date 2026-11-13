// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const calls = vi.hoisted(() => ({ n: 0 }));

vi.mock("@/components/settings/registry/useSettingState", async (orig) => {
  const real = await orig<typeof import("@/components/settings/registry/useSettingState")>();
  return { ...real, useSettingState: (key: string) => { calls.n++; return real.useSettingState(key); } };
});
vi.mock("@/components/settings/settingsSections", () => ({ renderSettingsSection: () => null }));
vi.mock("@/components/shared/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/utils/platform", async (orig) => ({
  ...(await orig<typeof import("@/utils/platform")>()),
  useIsMobile: () => false,
  useIsAndroid: () => false,
  getPlatformSync: () => "linux",
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined), isTauri: () => false }));

import SettingsModal from "@/components/settings/SettingsModal";
import { settingDefs } from "@/components/settings/registry/entries";
import { useUIStore } from "@/stores/uiStore";

beforeEach(() => {
  useUIStore.setState({ settingsOpen: true, settingsSection: "terminal", settingsQuery: "", settingsChangedOnly: true, settingsPluginPageId: null });
});
afterEach(cleanup);

test("one keystroke reads every setting's state once, not once per consumer", () => {
  render(<SettingsModal />);
  calls.n = 0;
  act(() => useUIStore.getState().setSettingsQuery("zzzz"));
  expect(calls.n).toBeLessThan(settingDefs().length * 2);
});
