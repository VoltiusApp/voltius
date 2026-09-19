import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, renderHook, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import i18n from "@/i18n";
import { useSessionStore } from "@/stores/sessionStore";
import { findLeafBySession, getPaneSessionIds, useLayoutStore } from "@/stores/layoutStore";
import { useDragStore } from "@/stores/dragStore";
import { openInSplit } from "@/services/hostStack";
import { usePaneDragController } from "@/components/panes/usePaneDragController";
import { useUIStore } from "@/stores/uiStore";
import { useStatusBarStore } from "@/stores/statusBarStore";
import { HostSessionsPanel } from "./HostSessionsPanel";

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
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/utils/icons", () => ({ getConnectionIcon: () => null, getConnectionIconColor: () => null }));

beforeAll(async () => { await i18n.changeLanguage("en"); });

const s = (id: string, connectionId: string, extra = {}) => ({ id, connectionId, connectionName: connectionId, status: "connected" as const, type: "ssh" as const, ...extra });

beforeEach(() => {
  useUIStore.setState({ activeNav: "terminal", sftpPanelOpen: false, hostPanelPinned: true });
  useSessionStore.setState({ sessions: [s("w1", "web"), s("w2", "web"), s("d1", "db")], activeSessionId: "w1" });
  useLayoutStore.setState({ splitTabs: [], root: null, splitTabActive: false, titlebarOrder: ["session:w1", "session:w2", "session:d1"] });
  useDragStore.setState({ isPointerDown: false, isDragging: false, dragType: null, sessionId: null, fromStackList: false, dropTarget: null, lastDragEndedAt: 0 });
  useStatusBarStore.setState({ mountedCount: 0 });
});

const rowOf = (id: string) => screen.getByTestId("host-sessions-rows").querySelector<HTMLElement>(`[data-titlebar-key="session:${id}"]`)!;
afterEach(cleanup);

describe("HostSessionsPanel", () => {
  it("lists the active host's sessions with numbering, and the header shows the translated count", () => {
    render(<HostSessionsPanel />);
    expect(screen.getByText("2 sessions")).toBeTruthy();
    const rows = within(screen.getByTestId("host-sessions-rows"));
    expect(rows.getByText("web")).toBeTruthy();
    expect(rows.getByText("web (2)")).toBeTruthy();
    expect(rows.queryByText("db")).toBeNull();
  });

  it("stays for a host with one session", () => {
    useSessionStore.setState({ activeSessionId: "d1" });
    render(<HostSessionsPanel />);
    expect(screen.getByTestId("host-sessions-panel")).toBeTruthy();
  });

  it("is hidden outside terminal view, on the SFTP page, or with no active session", () => {
    for (const apply of [
      () => useUIStore.setState({ activeNav: "hosts" as const }),
      () => useUIStore.setState({ sftpPanelOpen: true }),
      () => useSessionStore.setState({ activeSessionId: null }),
    ]) {
      useUIStore.setState({ activeNav: "terminal", sftpPanelOpen: false, hostPanelPinned: true });
      useSessionStore.setState({ activeSessionId: "w1" });
      apply();
      const { unmount } = render(<HostSessionsPanel />);
      expect(screen.queryByTestId("host-sessions-panel")).toBeNull();
      unmount();
    }
  });

  it("collapses to zero width and goes inert when unpinned, staying mounted so it can animate", () => {
    useUIStore.setState({ hostPanelPinned: false });
    render(<HostSessionsPanel />);
    const column = screen.getByTestId("host-sessions-panel");
    expect(column.style.width).toBe("0px");
    const card = screen.getByTestId("host-sessions-panel-card");
    expect(card.hasAttribute("inert")).toBe(true);
    expect(card.getAttribute("aria-hidden")).toBe("true");
  });

  it("paints a status-bar-colored filler beneath the card when a status bar is mounted", () => {
    useStatusBarStore.getState().increment();
    render(<HostSessionsPanel />);
    expect(screen.getByTestId("host-sessions-panel-status-filler")).toBeTruthy();
  });

  it("has no filler when no status bar is mounted", () => {
    render(<HostSessionsPanel />);
    expect(screen.queryByTestId("host-sessions-panel-status-filler")).toBeNull();
  });

  it("unpins from its header", () => {
    render(<HostSessionsPanel />);
    fireEvent.click(screen.getByTitle("Unpin session list"));
    expect(useUIStore.getState().hostPanelPinned).toBe(false);
  });

  it("marks a session that lives in a split with the in-split marker, and focuses its pane on click", () => {
    useLayoutStore.getState().createSplitTab("d1", "w2", "right");
    useSessionStore.setState({ activeSessionId: "w1" });
    render(<HostSessionsPanel />);
    const row = within(screen.getByTestId("host-sessions-rows"));
    expect(row.getByText(/in split/)).toBeTruthy();
    fireEvent.click(row.getByText("web (2)"));
    expect(useLayoutStore.getState().splitTabActive).toBe(true);
    expect(useSessionStore.getState().activeSessionId).toBe("w2");
  });

  it("keeps the in-split marker and the status on one truncated line with the full text as its title", () => {
    useLayoutStore.getState().createSplitTab("d1", "w2", "right");
    useSessionStore.setState({ activeSessionId: "w1" });
    render(<HostSessionsPanel />);
    const line = within(rowOf("w2")).getByTitle("in split · Connected · 0m");
    expect(line.querySelector(".truncate")?.textContent).toBe("in split · Connected · 0m");
  });

  it("sets no drop target on an in-split row, and clears the target when the pointer leaves the rows", () => {
    useLayoutStore.getState().createSplitTab("d1", "w2", "right");
    useSessionStore.setState({ activeSessionId: "w1" });
    render(<HostSessionsPanel />);
    act(() => useDragStore.setState({ isDragging: true, dragType: "tab", sessionId: "w1", sourceTitlebarKey: "session:w1" }));

    fireEvent.mouseMove(rowOf("w2"));
    expect(useDragStore.getState().dropTarget).toBeNull();

    fireEvent.mouseMove(rowOf("w1"));
    expect(useDragStore.getState().dropTarget).toMatchObject({ type: "titlebar", targetKey: "session:w1" });

    fireEvent.mouseLeave(screen.getByTestId("host-sessions-rows"));
    expect(useDragStore.getState().dropTarget).toBeNull();
  });
});

describe("a session never lands in two split tabs", () => {
  const expectEachSessionInOneSplit = () => {
    const ids = useLayoutStore.getState().splitTabs.flatMap((tab) => getPaneSessionIds(tab.root));
    expect(new Set(ids).size).toBe(ids.length);
  };

  beforeEach(() => {
    useSessionStore.setState({ sessions: [s("a1", "a"), s("a2", "a"), s("a3", "a"), s("b1", "b"), s("b2", "b")], activeSessionId: "a3" });
    useLayoutStore.setState({ titlebarOrder: [] });
    useLayoutStore.getState().createSplitTab("a1", "a2", "right");
    useLayoutStore.getState().setSplitTabActive(false);
    useSessionStore.setState({ activeSessionId: "a3" });
  });

  it("offers no Open in split when the only other members sit in a split", () => {
    render(<HostSessionsPanel />);
    for (const id of ["a1", "a2", "a3"]) expect(within(rowOf(id)).queryByTitle("Open in split")).toBeNull();
    expectEachSessionInOneSplit();
  });

  it("refuses a split whose base or incoming session is already in a split", () => {
    openInSplit("a3", [s("a1", "a"), s("a2", "a"), s("a3", "a")] as never, "a3");
    openInSplit("a1", [s("a1", "a"), s("a3", "a")] as never, "a3");
    expect(useLayoutStore.getState().splitTabs).toHaveLength(1);
    expectEachSessionInOneSplit();
  });

  it("starts no drag from an in-split row", () => {
    render(<HostSessionsPanel />);
    fireEvent.pointerDown(rowOf("a1"), { button: 0, clientX: 5, clientY: 5 });
    expect(useDragStore.getState().isPointerDown).toBe(false);
  });

  it("the drag controller never moves an in-split session into another split", () => {
    renderHook(() => usePaneDragController());
    useLayoutStore.getState().createSplitTab("b1", "b2", "right");
    const b1Pane = findLeafBySession(useLayoutStore.getState().root, "b1")!.id;
    const a1Tab = useLayoutStore.getState().splitTabs[0]!.id;

    for (const dropTarget of [
      { type: "session" as const, sessionId: "a3", position: "right" as const },
      { type: "pane" as const, paneId: b1Pane, position: "right" as const },
    ]) {
      act(() => useDragStore.getState().beginTabDrag("a1", 0, 0, "session:a1"));
      act(() => {
        useDragStore.setState({ isDragging: true, dropTarget });
        window.dispatchEvent(new MouseEvent("mouseup"));
      });
      expectEachSessionInOneSplit();
      expect(useLayoutStore.getState().activeSplitTabId).toBe(a1Tab);
    }
    expect(useLayoutStore.getState().splitTabs).toHaveLength(2);
  });
});
