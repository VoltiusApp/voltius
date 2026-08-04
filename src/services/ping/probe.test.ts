import { beforeEach, describe, expect, test, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@/services/credentials", () => ({ resolveJumpHosts: async () => [{ host: "j" }] }));

const { probeTarget } = await import("./probe");
import type { PingTarget } from "./pingTargets";

function target(over: Partial<PingTarget> = {}): PingTarget {
  return {
    key: "h1:22",
    host: "h1",
    port: 22,
    connectionIds: ["a"],
    sessionId: null,
    connection: { id: "a", host: "h1", port: 22 } as PingTarget["connection"],
    ...over,
  };
}

beforeEach(() => { invoke.mockReset(); });

describe("probeTarget", () => {
  test("uses the live session and opens no new connection", async () => {
    invoke.mockResolvedValue(12);
    const r = await probeTarget(target({ sessionId: "s1" }));
    expect(invoke).toHaveBeenCalledWith("ping_session", { sessionId: "s1" });
    expect(r).toEqual({ status: "up", latencyMs: 12 });
  });

  test("falls back to a tcp probe with no session", async () => {
    invoke.mockResolvedValue(30);
    await probeTarget(target());
    expect(invoke).toHaveBeenCalledWith("ping_host", { host: "h1", port: 22 });
  });

  test("walks the jump chain when the connection has jump hosts and no session", async () => {
    invoke.mockResolvedValue(90);
    await probeTarget(
      target({ connection: { id: "a", host: "h1", port: 22, jump_hosts: ["j"] } as unknown as PingTarget["connection"] }),
    );
    expect(invoke).toHaveBeenCalledWith("ping_host_via_jumps", {
      host: "h1",
      port: 22,
      jumpHosts: [{ host: "j" }],
    });
  });

  test("prefers the session over the jump chain", async () => {
    invoke.mockResolvedValue(5);
    await probeTarget(
      target({
        sessionId: "s2",
        connection: { id: "a", host: "h1", port: 22, jump_hosts: ["j"] } as unknown as PingTarget["connection"],
      }),
    );
    expect(invoke).toHaveBeenCalledWith("ping_session", { sessionId: "s2" });
  });

  test("null means down", async () => {
    invoke.mockResolvedValue(null);
    expect(await probeTarget(target())).toEqual({ status: "down" });
  });

  test("a throwing probe means unknown", async () => {
    invoke.mockRejectedValue(new Error("boom"));
    expect(await probeTarget(target())).toEqual({ status: "unknown" });
  });
});
