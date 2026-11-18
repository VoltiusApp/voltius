import { test, expect, vi, beforeEach } from "vitest";
import type { TerminalSession } from "@/types";

const { duplicateSession, reconnect, setSessionsLocked } = vi.hoisted(() => ({ duplicateSession: vi.fn(), reconnect: vi.fn(), setSessionsLocked: vi.fn() }));

vi.mock("@/services/duplicateSession", async () => {
  const actual = await vi.importActual<typeof import("@/services/duplicateSession")>("@/services/duplicateSession");
  return { ...actual, duplicateSession };
});
vi.mock("@/stores/sessionStore", () => ({ useSessionStore: { getState: () => ({ reconnect, setSessionsLocked, sessions: [] }) } }));
vi.mock("@/stores/shortcutStore", () => ({ getShortcutHint: (id: string) => `hint:${id}` }));

import { newSessionOnHostItem, sessionMenuItems } from "./sessionMenuItems";
import { useLayoutStore } from "@/stores/layoutStore";

const session: TerminalSession = { id: "s1", connectionId: "c1", connectionName: "srv", status: "connected", type: "ssh" };
const t = ((key: string) => key) as never;
const onClose = vi.fn();
const onRename = vi.fn();

const build = (over: Partial<TerminalSession> = {}, scope: "tab" | "pane" = "tab") =>
  sessionMenuItems({ session: { ...session, ...over }, t, closeLabel: "close-it", onClose, onRename, scope });

const PIN = "layout.titleBar.lock.pinTab";
const LOCK = "layout.titleBar.lock.lockTab";

beforeEach(() => {
  vi.clearAllMocks();
  useLayoutStore.setState({ splitTabs: [], pinnedKeys: [] });
});

test("duplicate entries target a tab and a right split, and carry their shortcut hints", () => {
  const items = build();
  const labels = items.map((i) => i.label);
  expect(labels).toEqual(["panes.header.rename", "panes.header.duplicate", "panes.header.duplicateSplit", "panes.header.reconnect", PIN, LOCK, "close-it"]);

  items[1].onClick!();
  expect(duplicateSession).toHaveBeenCalledWith("s1", "tab");
  items[2].onClick!();
  expect(duplicateSession).toHaveBeenCalledWith("s1", "right");
  expect(items[1].shortcut).toBe("hint:duplicate-session");
  expect(items[2].shortcut).toBe("hint:duplicate-session-split");
});

test("sessions that cannot be duplicated get no duplicate entries", () => {
  const items = build({ type: "serial" });
  expect(items.map((i) => i.label)).toEqual(["panes.header.rename", "panes.header.reconnect", PIN, LOCK, "close-it"]);
});

test("reconnect and close are wired to the store and the caller", () => {
  const items = build();
  items[3].onClick!();
  expect(reconnect).toHaveBeenCalledWith("s1");
  items[items.length - 1].onClick!();
  expect(onClose).toHaveBeenCalled();
  expect(items[items.length - 1].danger).toBe(true);
});

test("a locked session offers Unlock and greys out close with the reason", () => {
  const items = build({ locked: true });
  expect(items.map((i) => i.label).slice(-2)).toEqual(["layout.titleBar.lock.unlockTab", "close-it"]);
  expect(items[items.length - 1].disabledReason).toBe("layout.titleBar.lock.closeBlocked");
  items[items.length - 2].onClick!();
  expect(setSessionsLocked).toHaveBeenCalledWith(["s1"], false);
});

test("lock on a pane header targets only that pane", () => {
  const items = build({}, "pane");
  const lock = items.find((i) => i.label === "layout.titleBar.lock.lockPane")!;
  lock.onClick!();
  expect(setSessionsLocked).toHaveBeenCalledWith(["s1"], true);
});

test("pin toggles the session's titlebar entry", () => {
  build().find((i) => i.label === PIN)!.onClick!();
  expect(useLayoutStore.getState().pinnedKeys).toEqual(["session:s1"]);
  expect(build().find((i) => i.label === "layout.titleBar.lock.unpinTab")).toBeDefined();
});

test("rename hands the caller back control, since the editor lives on the tab", () => {
  const items = build();
  items[0].onClick!();
  expect(onRename).toHaveBeenCalledTimes(1);
});

test("new session on host duplicates into a tab, and is absent when the session cannot be duplicated", () => {
  const item = newSessionOnHostItem(t, session, "prod");
  expect(item?.label).toBe("layout.titleBar.stack.newSessionOn");
  item!.onClick();
  expect(duplicateSession).toHaveBeenCalledWith("s1", "tab");
  expect(newSessionOnHostItem(t, { ...session, containerExec: { kind: "lxc", vmid: 1, parentSessionId: "p" } }, "prod")).toBeNull();
  expect(newSessionOnHostItem(t, { ...session, type: "serial" }, "prod")).toBeNull();
});
