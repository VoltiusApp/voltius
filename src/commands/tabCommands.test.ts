// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { commands } from "./core.commands";
import { commandGuard } from "./defineCommand";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";
import type { TerminalSession } from "@/types";

const cmd = (id: string) => commands.find((c) => c.id === id)!;
const label = (id: string) => { const l = cmd(id).label; return typeof l === "function" ? l() : l; };
const session = (id: string): TerminalSession => ({ id, connectionId: "local", connectionName: id, status: "connected", type: "local" });

describe("tab lock and pin commands", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [session("a")], activeSessionId: "a" });
    useLayoutStore.setState({ splitTabs: [], splitTabActive: false, activeSplitTabId: null, pinnedKeys: [] });
  });

  test("lock toggles the active tab and its label follows", () => {
    expect(label("core:toggle-tab-lock")).toBe("Lock Tab");
    cmd("core:toggle-tab-lock").execute();
    expect(useSessionStore.getState().sessions[0].locked).toBe(true);
    expect(label("core:toggle-tab-lock")).toBe("Unlock Tab");
  });

  test("pin toggles the active tab's titlebar entry", () => {
    cmd("core:toggle-tab-pin").execute();
    expect(useLayoutStore.getState().pinnedKeys).toEqual(["session:a"]);
    expect(label("core:toggle-tab-pin")).toBe("Unpin Tab");
  });

  test("with no active tab the guard reports it and does not proceed", () => {
    useSessionStore.setState({ sessions: [], activeSessionId: null });
    expect(commandGuard(cmd("core:toggle-tab-lock"))?.()).toEqual({ message: "No terminal tab is active", proceed: false });
  });
});
