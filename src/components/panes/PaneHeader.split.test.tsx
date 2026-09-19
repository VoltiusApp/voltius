import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { findLeafBySession, getPaneSessionIds } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useDragStore } from "@/stores/dragStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { PaneHeader } from "./PaneHeader";
import type { TerminalSession } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
const focusSession = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useTerminal", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useTerminal")>("@/hooks/useTerminal");
  return { ...actual, focusSession };
});
vi.mock("@/utils/icons", () => ({
  getConnectionIcon: () => null,
  getConnectionIconColor: () => null,
  getDistroColor: () => null,
  getDistroIcon: () => "lucide:server",
  getDistroLabel: () => "",
}));

const s = (id: string): TerminalSession => ({ id, connectionId: id, connectionName: id, status: "connected", type: "local" });

beforeEach(() => {
  useDragStore.setState({ lastDragEndedAt: 0, isDragging: false });
  useSessionStore.setState({ sessions: ["a1", "a2", "b1", "b2", "c1"].map(s), activeSessionId: "b1" });
  useLayoutStore.setState({ splitTabs: [], root: null, activeSplitTabId: null, activePaneId: null, splitTabActive: false, titlebarOrder: [] });
  useLayoutStore.getState().createSplitTab("a1", "a2", "right");
  useLayoutStore.getState().createSplitTab("b1", "b2", "right");
});
afterEach(cleanup);

it("splits a pane with a session that is in no split tab", () => {
  const paneId = findLeafBySession(useLayoutStore.getState().root, "b1")!.id;
  render(<PaneHeader paneId={paneId} session={s("b1")} active />);
  fireEvent.contextMenu(screen.getByText("b1"));
  fireEvent.mouseEnter(screen.getByText("panes.header.split"));
  fireEvent.click(screen.getByText("panes.header.splitRight"));

  expect(getPaneSessionIds(useLayoutStore.getState().root)).toContain("c1");
  expect(useSessionStore.getState().activeSessionId).toBe("c1");
  const ids = useLayoutStore.getState().splitTabs.flatMap((tab) => getPaneSessionIds(tab.root));
  expect(new Set(ids).size).toBe(ids.length);
});
