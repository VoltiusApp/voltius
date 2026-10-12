import { test, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useMobileNavStore } from "@/stores/mobileNavStore";

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

afterEach(() => { cleanup(); useMobileNavStore.setState({ sheet: null }); });

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

test("the cloud sync row opens the sync sheet", () => {
  const { container } = render(<MobileAccountPage />);
  fireEvent.click(container.querySelector("button[data-account-sync]")!);
  expect(useMobileNavStore.getState().sheet).toEqual({ kind: "sync" });
});

test("a configured sync reads with the shared status label", () => {
  effective.value = { ...effective.value, configured: true, paused: false, status: "offline" };
  const { queryByText } = render(<MobileAccountPage />);
  expect(queryByText("layout.sync.status.offline")).not.toBeNull();
});
