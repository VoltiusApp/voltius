import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import i18n from "@/i18n";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useDragStore } from "@/stores/dragStore";
import { stackMemberLabels } from "@/utils/titlebarItems";
import type { TerminalSession } from "@/types";
import { HostSessionRows, type HostSessionRow } from "./HostSessionRows";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), startDragging: vi.fn() }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const s = (id: string, connectionId: string, extra: Partial<TerminalSession> = {}): TerminalSession => ({
  id, connectionId, connectionName: connectionId, status: "connected", type: "ssh", ...extra,
} as TerminalSession);

beforeAll(async () => { await i18n.changeLanguage("en"); });

beforeEach(() => {
  useDragStore.setState({ isDragging: false, dragType: null, fromStackList: false, dropTarget: null, sessionId: null, lastDragEndedAt: 0 });
  useLayoutStore.setState({ splitTabs: [], root: null, splitTabActive: false, activeSplitTabId: null, activePaneId: null, titlebarOrder: [] });
  useSessionStore.setState({ sessions: [s("w1", "web"), s("w2", "web")], activeSessionId: "w1" });
});
afterEach(cleanup);

function renderRows(rows: HostSessionRow[], overrides: Partial<React.ComponentProps<typeof HostSessionRows>> = {}) {
  const members = rows.map((row) => row.session);
  return render(
    <HostSessionRows
      rows={rows}
      members={members}
      labels={stackMemberLabels(members, members)}
      shownId={members[0].id}
      activeSessionId="w1"
      variant="panel"
      onActivate={() => {}}
      {...overrides}
    />,
  );
}

describe("HostSessionRows, variant=panel", () => {
  it("shows a connected session's two-line status text", () => {
    renderRows([{ session: s("w1", "web"), splitTabId: null }]);
    expect(screen.getByText(/Connected · 0m/)).toBeTruthy();
  });

  it("shows the error message on the status line for an errored session", () => {
    renderRows([{ session: s("w1", "web", { status: "error", errorMessage: "timed out" }), splitTabId: null }]);
    expect(screen.getByText("Error · timed out")).toBeTruthy();
  });

  it("marks a row that lives in a split and focuses its pane on click", () => {
    useLayoutStore.getState().createSplitTab("w1", "w2", "right");
    useLayoutStore.getState().setSplitTabActive(false);
    const tabId = useLayoutStore.getState().splitTabs[0]!.id;
    const w2 = useSessionStore.getState().sessions.find((x) => x.id === "w2")!;
    renderRows([{ session: w2, splitTabId: tabId }]);

    expect(screen.getByText(/in split/)).toBeTruthy();
    fireEvent.click(screen.getByText("web"));
    expect(useLayoutStore.getState().splitTabActive).toBe(true);
    expect(useSessionStore.getState().activeSessionId).toBe("w2");
  });

  it("shows a drop cue on the row an active drag targets", () => {
    const { container } = renderRows([{ session: s("w1", "web"), splitTabId: null }]);
    act(() => {
      useDragStore.setState({
        isDragging: true,
        dragType: "tab",
        fromStackList: false,
        sessionId: "w2",
        dropTarget: { type: "titlebar", targetKey: "session:w1", placement: "before" },
      });
    });
    const row = container.querySelector('[data-titlebar-key="session:w1"]')!;
    expect(row.querySelector('div[class*="top-0"]')).toBeTruthy();
    expect(row.querySelector('div[class*="bottom-0"]')).toBeNull();
  });

  it("shows no drop cue for a drag started from the stack list itself", () => {
    const { container } = renderRows([{ session: s("w1", "web"), splitTabId: null }]);
    act(() => {
      useDragStore.setState({
        isDragging: true,
        dragType: "tab",
        fromStackList: true,
        sessionId: "w2",
        dropTarget: { type: "titlebar", targetKey: "session:w1", placement: "before" },
      });
    });
    const row = container.querySelector('[data-titlebar-key="session:w1"]')!;
    expect(row.querySelector('div[class*="top-0"]')).toBeNull();
  });
});
