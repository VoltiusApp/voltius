import { test, expect, vi, beforeEach } from "vitest";
import { useLayoutStore, type SplitTab } from "@/stores/layoutStore";
import type { TerminalSession } from "@/types";

const { sessions } = vi.hoisted(() => ({ sessions: [] as TerminalSession[] }));
vi.mock("@/stores/sessionStore", () => ({ useSessionStore: { getState: () => ({ sessions }) } }));

import { splitTabMenuItems } from "./splitTabMenuItems";

const session = (id: string, name: string): TerminalSession =>
  ({ id, connectionId: "c1", connectionName: name, status: "connected", type: "local" });

const t = ((key: string, opts?: { count?: number; index?: number; name?: string }) => {
  if (opts?.count !== undefined) return `${key}:${opts.count}`;
  if (opts?.index !== undefined) return `${key}:${opts.index}:${opts.name}`;
  return key;
}) as never;
const onFocusPane = vi.fn();
const onClose = vi.fn();
const onRename = vi.fn();

const build = (over: Partial<SplitTab> = {}) => {
  const tab: SplitTab = {
    id: "tab-1",
    root: {
      type: "split", id: "split-1", direction: "h", ratio: 0.5,
      first: { type: "leaf", id: "pane-a", sessionId: "s1" },
      second: { type: "leaf", id: "pane-b", sessionId: "s2" },
    },
    activePaneId: "pane-a",
    maximizedPaneId: null,
    broadcastActive: false,
    ...over,
  };
  return { tab, items: splitTabMenuItems({ tab, t, onFocusPane, onClose, onRename }) };
};

beforeEach(() => {
  vi.clearAllMocks();
  sessions.splice(0, sessions.length, session("s1", "bash"), session("s2", "zsh"));
  useLayoutStore.setState({ root: null, activePaneId: null, maximizedPaneId: null, broadcastActive: false, splitTabActive: false, splitTabs: [], activeSplitTabId: null, titlebarOrder: [] });
});

test("entries are tab-scoped, and the close entry counts the sessions it takes down", () => {
  const { items } = build();
  expect(items.map((i) => i.label)).toEqual([
    "layout.titleBar.splitMenu.rename",
    "layout.titleBar.splitMenu.broadcastOn",
    "layout.titleBar.splitMenu.panes",
    "layout.titleBar.splitMenu.splitApart",
    "layout.titleBar.splitMenu.closeTab:2",
  ]);
  expect(items[4].danger).toBe(true);
  items[4].onClick!();
  expect(onClose).toHaveBeenCalled();
});

test("the broadcast entry reflects the tab's own state and toggles it", () => {
  const { tab, items } = build({ broadcastActive: true });
  useLayoutStore.setState({ splitTabs: [tab] });
  expect(items[1].label).toBe("layout.titleBar.splitMenu.broadcastOff");

  items[1].onClick!();
  expect(useLayoutStore.getState().broadcastActive).toBe(false);
  expect(useLayoutStore.getState().splitTabs[0].broadcastActive).toBe(false);
});

test("the panes submenu names every session and marks the active pane", () => {
  const { items } = build();
  const panes = items[2].children!;
  expect(panes.map((p) => p.label)).toEqual([
    "layout.titleBar.splitMenu.pane:1:bash",
    "layout.titleBar.splitMenu.pane:2:zsh",
  ]);
  expect(panes[0].icon).toBe("lucide:dot");
  expect(panes[1].icon).toBe("lucide:square");

  panes[1].onClick!();
  expect(onFocusPane).toHaveBeenCalledWith("pane-b");
});

test("splitting apart detaches every pane, dissolving the tab", () => {
  const { tab, items } = build();
  useLayoutStore.setState({ splitTabs: [tab], activeSplitTabId: null });

  items[3].onClick!();

  expect(useLayoutStore.getState().splitTabs).toEqual([]);
  expect(useLayoutStore.getState().splitTabActive).toBe(false);
});

test("rename hands the caller back control, since the editor lives on the tab", () => {
  const { items } = build();
  items[0].onClick!();
  expect(onRename).toHaveBeenCalledTimes(1);
});

test("the panes submenu prefers the name a session was given over its connection", () => {
  sessions[0] = { ...sessions[0], title: "deploy" };
  const { items } = build();
  expect(items[2].children!.map((p) => p.label)).toEqual([
    "layout.titleBar.splitMenu.pane:1:deploy",
    "layout.titleBar.splitMenu.pane:2:zsh",
  ]);
});
