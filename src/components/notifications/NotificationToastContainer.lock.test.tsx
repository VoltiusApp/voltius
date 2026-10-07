import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/account", () => ({ getAppLock: async () => null, setAppLock: async () => {} }));

import { NotificationToastContainer } from "./NotificationToastContainer";
import { useNotificationStore } from "@/stores/notificationStore";
import { useAppLockStore } from "@/stores/appLockStore";

afterEach(() => {
  cleanup();
  useAppLockStore.setState({ kind: null });
  useNotificationStore.setState({ toasts: [] });
});

function addToast() {
  act(() => {
    useNotificationStore.getState().addToast({
      source: { kind: "plugin", id: "system", name: "Voltius" },
      type: "toast",
      message: "session to prod-db closed",
      severity: "info",
      duration: 60_000,
    });
  });
}

test("toasts are not shown over the lock screen", () => {
  useAppLockStore.setState({ kind: "screen" });
  render(<NotificationToastContainer />);
  addToast();
  expect(screen.queryByText("session to prod-db closed")).toBeNull();
});

test("toasts show normally when unlocked", () => {
  render(<NotificationToastContainer />);
  addToast();
  expect(screen.getByText("session to prod-db closed")).toBeTruthy();
});
