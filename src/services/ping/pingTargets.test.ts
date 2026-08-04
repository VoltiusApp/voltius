import { describe, expect, test } from "vitest";
import { buildPingTargets } from "./pingTargets";
import type { Connection, TerminalSession } from "@/types";

function conn(over: Partial<Connection>): Connection {
  return { id: "c1", name: "c1", host: "h1", port: 22, username: "u", ...over } as Connection;
}

function sess(over: Partial<TerminalSession>): TerminalSession {
  return { id: "s1", connectionId: "c1", type: "ssh", status: "connected", ...over } as TerminalSession;
}

describe("buildPingTargets", () => {
  test("collapses connections sharing host:port into one target", () => {
    const targets = buildPingTargets(
      [conn({ id: "a" }), conn({ id: "b" }), conn({ id: "c", host: "h2" })],
      [],
    );
    expect(targets).toHaveLength(2);
    const first = targets.find((t) => t.key === "h1:22")!;
    expect(first.connectionIds).toEqual(["a", "b"]);
  });

  test("does not collapse the same host on different ports", () => {
    const targets = buildPingTargets([conn({ id: "a" }), conn({ id: "b", port: 2222 })], []);
    expect(targets.map((t) => t.key).sort()).toEqual(["h1:22", "h1:2222"]);
  });

  test("excludes ping_disabled connections", () => {
    const targets = buildPingTargets([conn({ id: "a", ping_disabled: true })], []);
    expect(targets).toHaveLength(0);
  });

  test("drops the target when every sharing connection is disabled", () => {
    const targets = buildPingTargets(
      [conn({ id: "a", ping_disabled: true }), conn({ id: "b", ping_disabled: true })],
      [],
    );
    expect(targets).toHaveLength(0);
  });

  test("excludes connections without a host, such as serial", () => {
    const targets = buildPingTargets([conn({ id: "a", host: "" })], []);
    expect(targets).toHaveLength(0);
  });

  test("attaches a live ssh session id", () => {
    const targets = buildPingTargets([conn({ id: "a" })], [sess({ id: "s9", connectionId: "a" })]);
    expect(targets[0].sessionId).toBe("s9");
  });

  test("ignores sessions that are not connected ssh", () => {
    const targets = buildPingTargets(
      [conn({ id: "a" })],
      [sess({ connectionId: "a", status: "connecting" }), sess({ connectionId: "a", type: "local" })],
    );
    expect(targets[0].sessionId).toBeNull();
  });

  test("a session on any sharing connection makes the whole target session-backed", () => {
    const targets = buildPingTargets(
      [conn({ id: "a" }), conn({ id: "b" })],
      [sess({ id: "s7", connectionId: "b" })],
    );
    expect(targets[0].sessionId).toBe("s7");
    expect(targets[0].connection.id).toBe("b");
  });
});
