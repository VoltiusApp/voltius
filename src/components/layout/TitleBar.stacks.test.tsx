import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useDragStore } from "@/stores/dragStore";
import { useUIStore } from "@/stores/uiStore";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import TitleBar from "./TitleBar";

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
vi.mock("@/utils/icons", () => ({ getConnectionIcon: () => null, getConnectionIconColor: () => null }));
vi.mock("@/components/shared/PickerSurface", () => ({
  PickerSurface: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="stack-menu">{children}</div> : null,
}));

const focusSession = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useTerminal", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useTerminal")>("@/hooks/useTerminal");
  return { ...actual, focusSession };
});

const s = (id: string, connectionId: string, extra = {}) => ({ id, connectionId, connectionName: connectionId, status: "connected" as const, type: "ssh" as const, ...extra });

beforeEach(() => {
  focusSession.mockClear();
  useToggleSettingsStore.setState({ values: {} });
  useUIStore.setState({ activeNav: "terminal", hostPanelPinned: false });
  useDragStore.setState({ lastDragEndedAt: 0, isDragging: false });
  useSessionStore.setState({ sessions: [s("w1", "web"), s("w2", "web", { title: "logs" }), s("d1", "db")], activeSessionId: "w2" });
  useLayoutStore.setState({ splitTabs: [], activeSplitTabId: null, root: null, splitTabActive: false, titlebarOrder: [] });
});
afterEach(cleanup);

it("renders one pill for a host with two sessions, with its count and shown session", () => {
  render(<TitleBar />);
  const pill = document.querySelector("[data-titlebar-key='stack:web']")!;
  expect(pill.textContent).toContain("web");
  expect(pill.textContent).toContain("· logs");
  expect(pill.textContent).toContain("2");
  expect(document.querySelector("[data-titlebar-key='session:d1']")).not.toBeNull();
});

it("renders flat tabs when the setting is off", () => {
  useToggleSettingsStore.setState({ values: { "group-tabs-by-host": false } });
  render(<TitleBar />);
  expect(document.querySelector("[data-titlebar-key='stack:web']")).toBeNull();
  expect(document.querySelectorAll("[data-titlebar-key^='session:']").length).toBe(3);
});

it("opens the session list from the chevron and switches session from a row", () => {
  render(<TitleBar />);
  fireEvent.click(screen.getByTestId("stack-chevron-web"));
  const menu = screen.getByTestId("stack-menu");
  fireEvent.click(within(menu).getByText("web"));
  expect(useSessionStore.getState().activeSessionId).toBe("w1");
});

it("numbers untitled members in the list", () => {
  useSessionStore.setState({ sessions: [s("w1", "web"), s("w3", "web")], activeSessionId: "w1" });
  render(<TitleBar />);
  fireEvent.click(screen.getByTestId("stack-chevron-web"));
  expect(within(screen.getByTestId("stack-menu")).getByText("web (2)")).toBeTruthy();
});

it("closes every member from the pill menu", () => {
  render(<TitleBar />);
  fireEvent.contextMenu(document.querySelector("[data-titlebar-key='stack:web']")!);
  fireEvent.click(screen.getByText("layout.titleBar.stack.closeAll"));
  expect(useSessionStore.getState().sessions.map((x) => x.id)).toEqual(["d1"]);
});

it("drops the chevron of the pinned host's stack", () => {
  useUIStore.setState({ hostPanelPinned: true });
  render(<TitleBar />);
  expect(screen.queryByTestId("stack-chevron-web")).toBeNull();
});

it("drops the chevron of the pinned host's stack even when a split tab has focus", () => {
  useUIStore.setState({ hostPanelPinned: true });
  useSessionStore.setState({ sessions: [s("w1", "web"), s("w2", "web", { title: "logs" }), s("w3", "web"), s("d1", "db")], activeSessionId: "w2" });
  useLayoutStore.getState().createSplitTab("d1", "w3", "right");
  useSessionStore.setState({ activeSessionId: "w3" });
  render(<TitleBar />);
  expect(screen.queryByTestId("stack-chevron-web")).toBeNull();
});

it("pinning from an unpinned host's context menu switches the pinned host instead of unpinning", () => {
  useUIStore.setState({ hostPanelPinned: true });
  useSessionStore.setState({ sessions: [s("w1", "web"), s("w2", "web", { title: "logs" }), s("d1", "db"), s("d2", "db")], activeSessionId: "w2" });
  render(<TitleBar />);
  fireEvent.contextMenu(document.querySelector("[data-titlebar-key='stack:db']")!);
  fireEvent.click(screen.getByText("layout.titleBar.stack.pin"));
  expect(useUIStore.getState().hostPanelPinned).toBe(true);
  expect(useSessionStore.getState().activeSessionId).toBe("d1");
});

it("unpinning from the pinned host's own context menu clears the flag", () => {
  useUIStore.setState({ hostPanelPinned: true });
  render(<TitleBar />);
  fireEvent.contextMenu(document.querySelector("[data-titlebar-key='stack:web']")!);
  fireEvent.click(screen.getByText("layout.titleBar.stack.unpin"));
  expect(useUIStore.getState().hostPanelPinned).toBe(false);
});

it("shows no close button on a stack pill, but keeps it on a single-session pill", () => {
  render(<TitleBar />);
  const closeOf = (key: string) => document.querySelector(`[data-titlebar-key='${key}'] .group-hover\\:opacity-100`);
  expect(closeOf("stack:web")).toBeNull();
  expect(closeOf("session:d1")).not.toBeNull();
});

it("labels the chevron and reports whether the list is open", () => {
  render(<TitleBar />);
  const chevron = screen.getByTestId("stack-chevron-web");
  expect(chevron.getAttribute("aria-label")).toBe("layout.titleBar.stack.sessions");
  expect(chevron.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(chevron);
  expect(chevron.getAttribute("aria-expanded")).toBe("true");
});

it("closes an open list when its host gets pinned from the pill's menu", () => {
  render(<TitleBar />);
  fireEvent.click(screen.getByTestId("stack-chevron-web"));
  expect(screen.getByTestId("stack-menu")).toBeTruthy();
  fireEvent.contextMenu(document.querySelector("[data-titlebar-key='stack:web']")!);
  fireEvent.click(screen.getByText("layout.titleBar.stack.pin"));
  expect(screen.queryByTestId("stack-menu")).toBeNull();
});

it("draws no drop cue on the bar for a drag that started on a list row", () => {
  render(<TitleBar />);
  const pill = document.querySelector("[data-titlebar-key='session:d1']")!;
  act(() => useDragStore.setState({ isDragging: true, dragType: "tab", sessionId: "w1", fromStackList: true, dropTarget: null }));
  fireEvent.mouseMove(pill);
  expect(useDragStore.getState().dropTarget).toBeNull();

  act(() => useDragStore.setState({ fromStackList: false }));
  fireEvent.mouseMove(pill);
  expect(useDragStore.getState().dropTarget).toMatchObject({ type: "titlebar", targetKey: "session:d1" });
});

describe("hover intent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stays open when the pointer crosses from the pill onto the surface", () => {
    render(<TitleBar />);
    const pill = document.querySelector("[data-titlebar-key='stack:web']")!;
    act(() => { fireEvent.mouseEnter(pill); vi.advanceTimersByTime(250); });
    expect(screen.getByTestId("stack-menu")).toBeTruthy();

    act(() => {
      fireEvent.mouseLeave(pill);
      fireEvent.mouseEnter(screen.getByTestId("stack-menu-surface"));
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId("stack-menu")).toBeTruthy();
  });

  it("a drag starting cancels a pending open and closes an open list", () => {
    render(<TitleBar />);
    const pill = document.querySelector("[data-titlebar-key='stack:web']")!;

    act(() => {
      fireEvent.mouseEnter(pill);
      useDragStore.setState({ isDragging: true, dragType: "tab" });
      vi.advanceTimersByTime(250);
    });
    expect(screen.queryByTestId("stack-menu")).toBeNull();

    act(() => { useDragStore.setState({ isDragging: false, dragType: null }); });
    act(() => { fireEvent.mouseEnter(pill); vi.advanceTimersByTime(250); });
    expect(screen.getByTestId("stack-menu")).toBeTruthy();

    act(() => { useDragStore.setState({ isDragging: true, dragType: "tab" }); });
    expect(screen.queryByTestId("stack-menu")).toBeNull();
  });

  it("clears its hover timer on unmount", () => {
    const { unmount } = render(<TitleBar />);
    const pill = document.querySelector("[data-titlebar-key='stack:web']")!;
    const before = vi.getTimerCount();
    fireEvent.mouseEnter(pill);
    const afterEnter = vi.getTimerCount();
    expect(afterEnter).toBeGreaterThan(before);
    unmount();
    expect(vi.getTimerCount()).toBeLessThan(afterEnter);
  });

  it("closes on Escape", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByTestId("stack-chevron-web"));
    expect(screen.getByTestId("stack-menu")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("stack-menu")).toBeNull();
  });

  it("a row drags with fromStackList true", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByTestId("stack-chevron-web"));
    const row = screen.getByTestId("stack-menu").querySelector("[data-titlebar-key='session:w1']")!;
    fireEvent.pointerDown(row, { button: 0, clientX: 5, clientY: 5 });
    const drag = useDragStore.getState();
    expect(drag.sessionId).toBe("w1");
    expect(drag.fromStackList).toBe(true);
  });

  it("a row's Open in split reaches createSplitTab and closes the list", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByTestId("stack-chevron-web"));
    const row = screen.getByTestId("stack-menu").querySelector("[data-titlebar-key='session:w1']")!;
    const spy = vi.spyOn(useLayoutStore.getState(), "createSplitTab");
    fireEvent.click(within(row as HTMLElement).getByTitle("layout.titleBar.stack.openInSplit"));
    expect(spy).toHaveBeenCalledWith("w2", "w1", "right");
    expect(screen.queryByTestId("stack-menu")).toBeNull();
  });

  it("settles the list itself when a hold (context menu or rename) releases with no further mouse event", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByTestId("stack-chevron-web"));
    const row = screen.getByTestId("stack-menu").querySelector("[data-titlebar-key='session:w1']")!;

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByText("panes.header.rename"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.getByTestId("stack-menu")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByTestId("stack-menu")).toBeNull();
  });

  it("drops a row menu's hold when the list is dismissed under it", () => {
    render(<TitleBar />);
    const chevron = screen.getByTestId("stack-chevron-web");
    fireEvent.click(chevron);
    fireEvent.contextMenu(screen.getByTestId("stack-menu").querySelector("[data-titlebar-key='session:w1']")!);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("stack-menu")).toBeNull();

    fireEvent.click(chevron);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId("stack-menu")).toBeTruthy();

    const pill = document.querySelector("[data-titlebar-key='stack:web']")!;
    act(() => { fireEvent.mouseLeave(pill); vi.advanceTimersByTime(300); });
    expect(screen.queryByTestId("stack-menu")).toBeNull();
  });

  it("stays open when the pointer is resting on the surface when a hold releases", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByTestId("stack-chevron-web"));
    const surface = screen.getByTestId("stack-menu-surface");
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100));

    const row = surface.querySelector("[data-titlebar-key='session:w1']")!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByText("panes.header.rename"));
    fireEvent.pointerMove(window, { clientX: 50, clientY: 50 });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.getByTestId("stack-menu")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId("stack-menu")).toBeTruthy();
  });
});
