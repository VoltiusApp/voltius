import { describe, test, expect } from "vitest";
import type { TerminalSession } from "@/types";
import { needsConnectionOverlay, sessionUserAtHost, sshOverlaySubtitle } from "./sessionOverlay";

const session = (type: TerminalSession["type"], status: TerminalSession["status"]) =>
  ({ id: "s1", connectionId: "c1", connectionName: "x", type, status }) as TerminalSession;

describe("needsConnectionOverlay", () => {
  test.each(["ssh", "serial", "local"] as const)("a %s session connecting or failing gets the overlay", (type) => {
    expect(needsConnectionOverlay(session(type, "connecting"))).toBe(true);
    expect(needsConnectionOverlay(session(type, "error"))).toBe(true);
  });

  // Nothing reconnects a disconnected session: the backoff loop runs under
  // 'connecting'. Covering it hid the scrollback and the serial reopen button.
  test.each(["ssh", "serial", "local"] as const)("a disconnected %s session keeps its terminal visible", (type) => {
    expect(needsConnectionOverlay(session(type, "disconnected"))).toBe(false);
  });

  test("a connected session has no overlay", () => {
    expect(needsConnectionOverlay(session("ssh", "connected"))).toBe(false);
  });

  test("a multiplayer session never gets the overlay", () => {
    expect(needsConnectionOverlay(session("multiplayer", "connecting"))).toBe(false);
  });
});

describe("the username shown for an SSH session", () => {
  const host = { username: "root", host: "web-01", port: 2222 };
  const alice = { id: "own", username: "alice" };

  test("the overlay subtitle shows who the plan connects as", () => {
    expect(sshOverlaySubtitle(host, { kind: "pick", identity: alice })).toBe("alice@web-01:2222");
    expect(sshOverlaySubtitle(host, { kind: "default", identity: alice })).toBe("alice@web-01:2222");
  });

  test("without a pick the overlay subtitle is the host's own user, as before", () => {
    expect(sshOverlaySubtitle(host, { kind: "host" })).toBe("root@web-01:2222");
  });

  test("after use-host-this-time the subtitle shows the host's own user", () => {
    expect(sshOverlaySubtitle(host, { kind: "pick", identity: alice }, true)).toBe("root@web-01:2222");
  });

  test("the status bar shows the user the session authenticated as, else the host's", () => {
    expect(sessionUserAtHost({ connectedUsername: "alice" }, host)).toBe("alice@web-01");
    expect(sessionUserAtHost({}, host)).toBe("root@web-01");
    expect(sessionUserAtHost(undefined, host)).toBe("root@web-01");
  });
});
