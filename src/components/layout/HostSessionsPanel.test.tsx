import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, renderHook, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import i18n from "@/i18n";
import { useSessionStore } from "@/stores/sessionStore";
import { findLeafBySession, getPaneSessionIds, useLayoutStore } from "@/stores/layoutStore";
import { useDragStore } from "@/stores/dragStore";
import { openInSplit } from "@/services/hostStack";
import { usePaneDragController } from "@/components/panes/usePaneDragController";
import { useUIStore } from "@/stores/uiStore";
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

  it("is hidden when unpinned, outside terminal view, or on the SFTP page", () => {
    for (const state of [{ hostPanelPinned: false }, { activeNav: "hosts" as const }, { sftpPanelOpen: true }]) {
      useUIStore.setState({ activeNav: "terminal", sftpPanelOpen: false, hostPanelPinned: true, ...state });
      const { unmount } = render(<HostSessionsPanel />);
      expect(screen.queryByTestId("host-sessions-panel")).toBeNull();
      unmount();
    }
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
