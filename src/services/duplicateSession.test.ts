import { describe, test, expect, vi, beforeEach } from "vitest";
import type { TerminalSession } from "@/types";

const beginSession = vi.fn((connectionId: string, _cwd?: string) => `sess-of-${connectionId}`);
const beginLocalSession = vi.fn((shell?: string, _cwd?: string) => `local-of-${shell ?? "default"}`);
const setActive = vi.fn();

let sessions: TerminalSession[] = [];

vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: {
    getState: () => ({ sessions, beginSession, beginLocalSession, setActive }),
  },
}));
vi.mock("@/services/launch", () => ({ goToTerminal: vi.fn() }));

import { useLayoutStore, getPaneSessionIds, findLeafBySession } from "@/stores/layoutStore";
import { useTerminalCwdStore } from "@/stores/terminalCwdStore";
import { canDuplicateSession, duplicateSession, findSessionPane, handleDuplicateShortcut } from "./duplicateSession";

const ssh: TerminalSession = { id: "s1", connectionId: "c1", connectionName: "srv", status: "connected", type: "ssh" };

beforeEach(() => {
  vi.clearAllMocks();
  sessions = [ssh];
  useTerminalCwdStore.setState({ cwds: {} });
  useLayoutStore.setState({
    root: null, activePaneId: null, maximizedPaneId: null, broadcastActive: false,
    splitTabActive: false, splitTabs: [], activeSplitTabId: null, titlebarOrder: [],
  });
});

describe("canDuplicateSession", () => {
  test("allows ssh and local", () => {
    expect(canDuplicateSession(ssh)).toBe(true);
    expect(canDuplicateSession({ ...ssh, type: "local" })).toBe(true);
  });

  test("refuses serial, multiplayer, container exec and unknown sessions", () => {
    expect(canDuplicateSession({ ...ssh, type: "serial" })).toBe(false);
    expect(canDuplicateSession({ ...ssh, type: "multiplayer" })).toBe(false);
    expect(canDuplicateSession({ ...ssh, containerExec: { kind: "docker", containerId: "x", parentSessionId: "s1" } })).toBe(false);
    expect(canDuplicateSession(undefined)).toBe(false);
  });
});

describe("duplicateSession", () => {
  test("tab target opens a second session on the same connection and activates it", () => {
    const id = duplicateSession("s1", "tab");
    expect(beginSession).toHaveBeenCalledWith("c1", undefined);
    expect(id).toBe("sess-of-c1");
    expect(setActive).toHaveBeenCalledWith("sess-of-c1");
    expect(useLayoutStore.getState().splitTabs).toHaveLength(0);
  });

  test("local sessions duplicate their own shell rather than a connection", () => {
    sessions = [{ ...ssh, type: "local", connectionId: "local", localShell: "/bin/zsh" }];
    const id = duplicateSession("s1", "tab");
    expect(beginLocalSession).toHaveBeenCalledWith("/bin/zsh", undefined);
    expect(id).toBe("local-of-/bin/zsh");
    expect(beginSession).not.toHaveBeenCalled();
  });

  test("opens in the source session's directory", () => {
    useTerminalCwdStore.getState().setCwd("s1", "/srv/app");
    duplicateSession("s1", "tab");
    expect(beginSession).toHaveBeenCalledWith("c1", "/srv/app");
  });

  test("local duplicates carry the directory too", () => {
    sessions = [{ ...ssh, type: "local", connectionId: "local", localShell: "/bin/zsh" }];
    useTerminalCwdStore.getState().setCwd("s1", "/home/kipavy/work");
    duplicateSession("s1", "tab");
    expect(beginLocalSession).toHaveBeenCalledWith("/bin/zsh", "/home/kipavy/work");
  });

  test("falls back to the default directory when the source never reported one", () => {
    duplicateSession("s1", "tab");
    expect(beginSession).toHaveBeenCalledWith("c1", undefined);
  });

  test("takes the source session's directory, not the anchor pane's", () => {
    useTerminalCwdStore.getState().setCwd("s1", "/srv/app");
    useTerminalCwdStore.getState().setCwd("s9", "/tmp");
    duplicateSession("s1", "right", { sessionId: "s9" });
    expect(beginSession).toHaveBeenCalledWith("c1", "/srv/app");
  });

  test("refuses a session that cannot be duplicated", () => {
    sessions = [{ ...ssh, type: "serial" }];
    expect(duplicateSession("s1", "right")).toBeNull();
    expect(beginSession).not.toHaveBeenCalled();
    expect(useLayoutStore.getState().splitTabs).toHaveLength(0);
  });

  test("split target from a fullscreen session builds a split tab holding both", () => {
    const id = duplicateSession("s1", "right");
    const { splitTabs, splitTabActive } = useLayoutStore.getState();
    expect(splitTabs).toHaveLength(1);
    expect(getPaneSessionIds(splitTabs[0].root)).toEqual(["s1", id]);
    expect(splitTabActive).toBe(true);
    expect(setActive).toHaveBeenCalledWith(id);
  });

  test("split target splits the pane in place when the session is already in a split tab", () => {
    useLayoutStore.getState().createSplitTab("s1", "s2", "right");
    const tabId = useLayoutStore.getState().activeSplitTabId;
    const id = duplicateSession("s1", "bottom");
    const { splitTabs, activeSplitTabId } = useLayoutStore.getState();
    expect(splitTabs).toHaveLength(1);
    expect(activeSplitTabId).toBe(tabId);
    expect(getPaneSessionIds(splitTabs[0].root).sort()).toEqual(["s1", "s2", id].sort());
  });

  test("split target activates the split tab the session lives in before splitting", () => {
    useLayoutStore.getState().createSplitTab("s1", "s2", "right");
    const hostTabId = useLayoutStore.getState().activeSplitTabId;
    useLayoutStore.getState().createSplitTab("s3", "s4", "right");

    const id = duplicateSession("s1", "right");

    const { splitTabs, activeSplitTabId } = useLayoutStore.getState();
    expect(activeSplitTabId).toBe(hostTabId);
    const hostTab = splitTabs.find((tab) => tab.id === hostTabId)!;
    expect(getPaneSessionIds(hostTab.root)).toContain(id);
    expect(splitTabs).toHaveLength(2);
  });
});

describe("anchored duplicates", () => {
  test("a pane anchor splits that pane rather than the source session's own", () => {
    useLayoutStore.getState().createSplitTab("s2", "s3", "right");
    const targetPane = findLeafBySession(useLayoutStore.getState().splitTabs[0].root, "s3")!;

    const id = duplicateSession("s1", "bottom", { paneId: targetPane.id });

    const root = useLayoutStore.getState().splitTabs[0].root;
    expect(getPaneSessionIds(root)).toContain(id);
    expect(useLayoutStore.getState().splitTabs).toHaveLength(1);
  });

  test("a session anchor not yet in a split builds a split tab around that session", () => {
    const id = duplicateSession("s1", "right", { sessionId: "s9" });
    expect(getPaneSessionIds(useLayoutStore.getState().splitTabs[0].root)).toEqual(["s9", id]);
  });
});

describe("handleDuplicateShortcut", () => {
  const event = (init: Partial<KeyboardEventInit> & { type?: string } = {}) =>
    new KeyboardEvent(init.type ?? "keydown", { key: "d", ctrlKey: true, shiftKey: true, ...init });

  test("claims and runs the tab shortcut on keydown", () => {
    expect(handleDuplicateShortcut(event(), "s1")).toBe(true);
    expect(beginSession).toHaveBeenCalledWith("c1", undefined);
  });

  test("claims keyup without duplicating, so the key never reaches the PTY twice", () => {
    expect(handleDuplicateShortcut(event({ type: "keyup" }), "s1")).toBe(true);
    expect(beginSession).not.toHaveBeenCalled();
  });

  test("ignores unrelated keys", () => {
    expect(handleDuplicateShortcut(event({ key: "x" }), "s1")).toBe(false);
  });
});

describe("findSessionPane", () => {
  test("returns the split tab and pane holding a session", () => {
    useLayoutStore.getState().createSplitTab("s1", "s2", "right");
    const { splitTabs } = useLayoutStore.getState();
    const found = findSessionPane(splitTabs, "s2");
    expect(found?.tabId).toBe(splitTabs[0].id);
    expect(found?.paneId).toBe(findLeafBySession(splitTabs[0].root, "s2")!.id);
  });

  test("returns null for a session that is not in any split tab", () => {
    expect(findSessionPane(useLayoutStore.getState().splitTabs, "s1")).toBeNull();
  });
});
