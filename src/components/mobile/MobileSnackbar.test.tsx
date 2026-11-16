import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import MobileSnackbarHost from "./MobileSnackbar";
import { useNotificationStore } from "@/stores/notificationStore";
import { appToast } from "@/services/appToast";

type W = Window & { VoltiusHaptics?: { perform(kind: string): boolean } };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as W).VoltiusHaptics;
  useNotificationStore.setState({ toasts: [] });
});

test("shows one toast at a time, oldest first", () => {
  render(<MobileSnackbarHost />);
  act(() => { appToast("info", "first"); appToast("info", "second"); });
  expect(screen.getByText("first")).toBeTruthy();
  expect(screen.queryByText("second")).toBeNull();
  act(() => { vi.advanceTimersByTime(4000); });
  expect(screen.queryByText("first")).toBeNull();
  expect(screen.getByText("second")).toBeTruthy();
});

test("the action runs once and dismisses the snackbar", () => {
  const retry = vi.fn();
  render(<MobileSnackbarHost />);
  act(() => { appToast("error", "Permission denied", { action: { label: "Retry", onClick: retry } }); });
  fireEvent.click(screen.getByText("Retry"));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Permission denied")).toBeNull();
});

test("an error plays the reject haptic", () => {
  const perform = vi.fn(() => true);
  (window as W).VoltiusHaptics = { perform };
  render(<MobileSnackbarHost />);
  act(() => { appToast("error", "boom"); });
  expect(perform).toHaveBeenCalledWith("reject");
});

test("progress toasts are not snackbars", () => {
  render(<MobileSnackbarHost />);
  act(() => {
    useNotificationStore.getState().addToast({ source: { kind: "app" }, type: "progress", message: "uploading", severity: "info", duration: 0 });
  });
  expect(screen.queryByText("uploading")).toBeNull();
});

test("a_hidden_anchor_on_the_stack_is_not_counted", () => {
  const vh = window.innerHeight;
  const added: HTMLElement[] = [];
  const docked = (attr: string, top: number, bottom: number, parent: HTMLElement = document.body) => {
    const el = document.createElement("div");
    added.push(el);
    el.setAttribute(attr, "");
    el.getBoundingClientRect = () => ({ top, bottom, height: bottom - top } as DOMRect);
    parent.appendChild(el);
  };
  const tucked = document.createElement("div");
  tucked.style.visibility = "hidden";
  document.body.appendChild(tucked);
  added.push(tucked);
  docked("data-mobile-tab-bar", vh - 80, vh);
  docked("data-snackbar-anchor", vh - 200, vh - 80, tucked);
  render(<MobileSnackbarHost />);
  act(() => { appToast("info", "saved"); });
  const bottom = () => parseFloat((document.querySelector("[data-mobile-snackbar]") as HTMLElement).style.bottom);
  const hiddenBottom = bottom();
  tucked.style.visibility = "";
  act(() => { vi.advanceTimersByTime(250); });
  expect(bottom() - hiddenBottom).toBe(120);
  added.forEach((el) => el.remove());
});
