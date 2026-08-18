import { test, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NotificationBell } from "./NotificationBell";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUIStore } from "@/stores/uiStore";

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

afterEach(cleanup);

beforeEach(() => {
  useUIStore.setState({ notificationCenterOpen: false, notificationFocusId: null });
  useNotificationStore.setState({ inbox: [], banners: [], history: [] });
});

test("the popover follows the store, so a deep link can raise it", () => {
  render(<NotificationBell />);
  expect(screen.queryByText("notifications.bell.clearHistory")).toBeNull();
  act(() => useUIStore.getState().openNotificationCenter(null));
  expect(screen.getByText("notifications.bell.clearHistory")).toBeTruthy();
});

test("a bell that computes as hidden leaves the popover to the visible one", () => {
  // The mobile shell keeps the SFTP tab's bell mounted under `invisible`, and
  // the popover is portalled to the body, where an ancestor's visibility no
  // longer hides it. jsdom does not inherit `visibility` down the tree, so the
  // computed value is stubbed rather than set on a wrapper.
  const real = window.getComputedStyle;
  window.getComputedStyle = ((el: Element) =>
    el instanceof HTMLButtonElement
      ? ({ visibility: "hidden" } as CSSStyleDeclaration)
      : real(el)) as typeof window.getComputedStyle;
  try {
    render(<NotificationBell />);
    act(() => useUIStore.getState().openNotificationCenter(null));
    expect(screen.queryByText("notifications.bell.clearHistory")).toBeNull();
  } finally {
    window.getComputedStyle = real;
  }
});

test("an entry the link names is scrolled to and the focus is cleared", () => {
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  useNotificationStore.setState({
    inbox: [
      {
        id: "invite:42",
        kind: "invite",
        message: "an invitation",
        actions: [],
        source: { kind: "app", area: "team" },
        state: "pending",
        createdAt: Date.now(),
      },
    ],
  });
  render(<NotificationBell />);
  act(() => useUIStore.getState().openNotificationCenter("invite:42"));
  expect(scrollIntoView).toHaveBeenCalled();
  expect(useUIStore.getState().notificationFocusId).toBeNull();
});

test("an id no longer in the inbox still leaves the popover open", () => {
  render(<NotificationBell />);
  act(() => useUIStore.getState().openNotificationCenter("invite:gone"));
  expect(screen.getByText("notifications.bell.clearHistory")).toBeTruthy();
  expect(useUIStore.getState().notificationFocusId).toBeNull();
});

// The mobile shell swaps the foreground tab's bell while the SFTP tab's bell
// stays mounted behind `invisible`.
function TwoBells({ hostsTab }: { hostsTab: boolean }) {
  return (
    <>
      {hostsTab && <div data-testid="hosts"><NotificationBell /></div>}
      <div data-testid="sftp"><NotificationBell /></div>
    </>
  );
}

function stubHiddenSftpBell(hidden: () => boolean) {
  const real = window.getComputedStyle;
  window.getComputedStyle = ((el: Element) =>
    el instanceof HTMLButtonElement && el.closest("[data-testid='sftp']") && hidden()
      ? ({ visibility: "hidden" } as CSSStyleDeclaration)
      : real(el)) as typeof window.getComputedStyle;
  return () => {
    window.getComputedStyle = real;
  };
}

const popovers = () => screen.queryAllByText("notifications.bell.clearHistory").length;

test("only the visible bell paints while both are mounted", () => {
  const restore = stubHiddenSftpBell(() => true);
  try {
    render(<TwoBells hostsTab />);
    act(() => useUIStore.getState().openNotificationCenter(null));
    expect(popovers()).toBe(1);
  } finally {
    restore();
  }
});

test("the popover follows the bell a tab switch makes visible", () => {
  let sftpHidden = true;
  const restore = stubHiddenSftpBell(() => sftpHidden);
  try {
    const { rerender } = render(<TwoBells hostsTab />);
    act(() => useUIStore.getState().openNotificationCenter(null));
    expect(popovers()).toBe(1);

    sftpHidden = false;
    rerender(<TwoBells hostsTab={false} />);

    expect(popovers()).toBe(1);
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(useUIStore.getState().notificationCenterOpen).toBe(false);
  } finally {
    restore();
  }
});

test("a link raised with no visible bell paints once one mounts", () => {
  const restore = stubHiddenSftpBell(() => true);
  try {
    const { rerender } = render(<TwoBells hostsTab={false} />);
    act(() => useUIStore.getState().openNotificationCenter(null));
    expect(popovers()).toBe(0);

    rerender(<TwoBells hostsTab />);
    expect(popovers()).toBe(1);
  } finally {
    restore();
  }
});
