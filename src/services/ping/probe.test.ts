import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@/services/credentials", () => ({ resolveJumpHosts: async () => [{ host: "j" }], findConnection: () => undefined }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
const getSecret = vi.fn(async (_k: string): Promise<string | null> => null);
vi.mock("@/services/vault", () => ({ getSecret: (k: string) => getSecret(k) }));
vi.mock("@/stores/connectivitySettingsStore", () => ({ getGlobalProxy: () => ({ mode: "none" }) }));

const { probeTarget, PROBE_TIMEOUT_MS } = await import("./probe");
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

beforeEach(() => {
  invoke.mockReset();
  getSecret.mockClear();
});

describe("probeTarget", () => {
  test("uses the live session and opens no new connection", async () => {
    invoke.mockResolvedValue(12);
    const r = await probeTarget(target({ sessionId: "s1" }));
    expect(invoke).toHaveBeenCalledWith("ping_session", { sessionId: "s1" });
    expect(r).toEqual({ status: "up", latencyMs: 12 });
  });

  test("falls back to a tcp probe with no session", async () => {
    invoke.mockResolvedValue({ up: 30 });
    await probeTarget(target());
    expect(invoke).toHaveBeenCalledWith("ping_host", { host: "h1", port: 22, proxy: null, knockWindowSecs: null });
  });

  test("walks the jump chain when the connection has jump hosts and no session", async () => {
    invoke.mockResolvedValue({ up: 90 });
    await probeTarget(
      target({ connection: { id: "a", host: "h1", port: 22, jump_hosts: ["j"] } as unknown as PingTarget["connection"] }),
    );
    expect(invoke).toHaveBeenCalledWith("ping_host_via_jumps", {
      host: "h1",
      port: 22,
      jumpHosts: [{ host: "j" }],
      proxy: null,
      knockWindowSecs: null,
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

  test("down means down on the tcp path", async () => {
    invoke.mockResolvedValue("down");
    expect(await probeTarget(target())).toEqual({ status: "down" });
  });

  test("null means unknown on the session path", async () => {
    invoke.mockResolvedValue(null);
    expect(await probeTarget(target({ sessionId: "s1" }))).toEqual({ status: "unknown" });
  });

  test("passes the knock window and maps knock_closed to the knock status", async () => {
    invoke.mockResolvedValue("knock_closed");
    const r = await probeTarget(target({ connection: { id: "a", host: "h1", port: 22, port_knock: { enabled: true, window_secs: 60 } } as PingTarget["connection"] }));
    expect(invoke).toHaveBeenCalledWith("ping_host", { host: "h1", port: 22, proxy: null, knockWindowSecs: 60 });
    expect(r).toEqual({ status: "knock" });
  });

  test("a gated host with no stored sequence still probes and never reads the sequence", async () => {
    invoke.mockResolvedValue("knock_closed");
    const gated = { id: "a", host: "h1", port: 22, port_knock: { enabled: true, window_secs: 60 } } as PingTarget["connection"];
    expect(await probeTarget(target({ connection: gated }))).toEqual({ status: "knock" });
    expect(getSecret.mock.calls.filter(([k]) => k.startsWith("knock_sequence:"))).toEqual([]);
  });

  test("maps the up and down outcomes", async () => {
    invoke.mockResolvedValueOnce({ up: 30 });
    expect(await probeTarget(target())).toEqual({ status: "up", latencyMs: 30 });
    invoke.mockResolvedValueOnce("down");
    expect(await probeTarget(target())).toEqual({ status: "down" });
  });

  test("a throwing probe means unknown", async () => {
    invoke.mockRejectedValue(new Error("boom"));
    expect(await probeTarget(target())).toEqual({ status: "unknown" });
  });

  test("sends the host's proxy to ping_host", async () => {
    invoke.mockResolvedValue({ up: 12 });
    await probeTarget(target({ connection: { id: "a", host: "h1", port: 22, proxy: { mode: "system" } } as PingTarget["connection"] }));
    expect(invoke).toHaveBeenCalledWith("ping_host", { host: "h1", port: 22, proxy: { kind: "system" }, knockWindowSecs: null });
  });

  describe("timeout", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    test("a probe that never settles resolves to unknown after the timeout", async () => {
      invoke.mockReturnValue(new Promise(() => {}));
      const result = probeTarget(target());
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
      expect(await result).toEqual({ status: "unknown" });
    });
  });
});
