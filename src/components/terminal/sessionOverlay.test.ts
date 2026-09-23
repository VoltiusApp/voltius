import { describe, test, expect } from "vitest";
import type { TerminalSession } from "@/types";
import { needsConnectionOverlay } from "./sessionOverlay";

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
