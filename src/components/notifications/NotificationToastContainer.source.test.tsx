import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/account", () => ({ getAppLock: async () => null, setAppLock: async () => {} }));

import { NotificationToastContainer } from "./NotificationToastContainer";
import { APP_SOURCE, useNotificationStore, type NotificationSource } from "@/stores/notificationStore";

afterEach(() => {
  cleanup();
  useNotificationStore.setState({ toasts: [] });
});

const DOCKER: NotificationSource = { kind: "plugin", id: "docker", name: "Docker" };

function show(source: NotificationSource, type: "toast" | "progress") {
  render(<NotificationToastContainer />);
  act(() => {
    useNotificationStore.getState().addToast({ source, type, message: "container restarted", severity: "info", duration: 0 });
  });
}

test.each(["toast", "progress"] as const)("a %s from the app carries no source tag", (type) => {
  show(APP_SOURCE, type);
  expect(screen.getByText("container restarted")).toBeTruthy();
  expect(screen.queryByText(/^\[.*\]$/)).toBeNull();
});

test.each(["toast", "progress"] as const)("a %s from a plugin names the plugin", (type) => {
  show(DOCKER, type);
  expect(screen.getByText("[Docker]")).toBeTruthy();
});
