import { beforeEach, expect, test } from "vitest";
import { broadcastTargets } from "./broadcast";
import { useLayoutStore, type PaneNode } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useTeamSessionStore, type MultiplayerSessionState } from "@/stores/teamSessionStore";
import type { TerminalSession } from "@/types";

const session = (over: Partial<TerminalSession> & { id: string }): TerminalSession => ({
  connectionId: "c1", connectionName: "host-1", status: "connected", type: "ssh", ...over,
});

const mpState = (over: Partial<MultiplayerSessionState>): MultiplayerSessionState => ({
  multiplayerSessionId: "m1", role: "host", myUserId: "me", participants: [],
  controlHolder: "", controlRequester: null, connection: {} as MultiplayerSessionState["connection"],
  ...over,
});

/** Two panes: "keep" is always eligible, "probe" is what each case varies. */
const twoPanes: PaneNode = {
  type: "split", id: "sp1", direction: "h", ratio: 0.5,
  first: { type: "leaf", id: "p1", sessionId: "keep" },
  second: { type: "leaf", id: "p2", sessionId: "probe" },
};

const ids = () => broadcastTargets().map((s) => s.id);

function setup(probe: TerminalSession | null, connections: Record<string, MultiplayerSessionState> = {}) {
  useLayoutStore.setState({ root: twoPanes });
  useSessionStore.setState({ sessions: [session({ id: "keep" }), ...(probe ? [probe] : [])] });
  useTeamSessionStore.setState({ connections });
}

beforeEach(() => setup(session({ id: "probe" })));

test("includes a connected pane, in pane order", () => {
  expect(ids()).toEqual(["keep", "probe"]);
});

test("skips a pane with no session row", () => {
  setup(null);
  expect(ids()).toEqual(["keep"]);
});

test("skips a session that is not connected", () => {
  for (const status of ["connecting", "disconnected", "error"] as const) {
    setup(session({ id: "probe", status }));
    expect(ids(), status).toEqual(["keep"]);
  }
});

test("skips a multiplayer-type session", () => {
  setup(session({ id: "probe", type: "multiplayer" }));
  expect(ids()).toEqual(["keep"]);
});

/**
 * The clause that keeps typed input out of a shell someone else is driving.
 * Without it a broadcast would be routed into another user's session.
 */
test("skips a session whose control is held by another user", () => {
  setup(session({ id: "probe" }), { probe: mpState({ myUserId: "me", controlHolder: "someone-else" }) });
  expect(ids()).toEqual(["keep"]);
});

test("includes a shared session whose control the local user holds", () => {
  setup(session({ id: "probe" }), { probe: mpState({ myUserId: "me", controlHolder: "me" }) });
  expect(ids()).toEqual(["keep", "probe"]);
});

test("includes a shared session with no control holder", () => {
  setup(session({ id: "probe" }), { probe: mpState({ myUserId: "me", controlHolder: "" }) });
  expect(ids()).toEqual(["keep", "probe"]);
});
