import { test, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
const effective = vi.hoisted(() => ({
  value: { configured: false, paused: false, status: "idle", lastSync: null, error: null, errorSource: null },
}));
vi.mock("@/hooks/useSyncProviders", () => ({ useSyncProviders: () => ({ providers: [], effective: effective.value }) }));

import MobileAccountPage from "./MobileAccountPage";

afterEach(cleanup);

test("a paused sync reads as paused, not off", () => {
  effective.value = { ...effective.value, paused: true };
  const { queryByText } = render(<MobileAccountPage />);
  expect(queryByText("layout.sync.paused")).not.toBeNull();
  expect(queryByText("mobile.account.off")).toBeNull();
});

test("a sync that was never set up reads as off", () => {
  effective.value = { ...effective.value, paused: false };
  const { queryByText } = render(<MobileAccountPage />);
  expect(queryByText("mobile.account.off")).not.toBeNull();
});
