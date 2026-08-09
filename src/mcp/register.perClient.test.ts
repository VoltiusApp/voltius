import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleBridgePayload, resetClientTools } from "./register";
import { registerContributions, clearContributions } from "./contributions";

const sessions = [{ id: "s1", type: "ssh", status: "connected", connectionId: "c1", connectionName: "h" }];
vi.mock("./hostApi", () => ({
  getMcpHostApi: () => ({
    sessions: { list: () => sessions, open: async () => "s1", close: async () => {} },
    audit: { record: vi.fn() },
    // open_session guards its connectionId against this list before touching
    // `owned`, so an empty list would make every ownership assertion vacuous.
    connections: { list: async () => [{ id: "c1", name: "Prod", host: "h" }] },
  }),
}));

const TOOL = { name: "a", description: "A.", inputSchema: { type: "object" }, execute: async () => 1 };

describe("per-client tool state", () => {
  beforeEach(() => {
    resetClientTools();
    clearContributions("p-one");
  });

  it("gives two clients separate ownership sets", async () => {
    const a = await handleBridgePayload({ op: "tools/call", name: "open_session", args: { connectionId: "c1" }, clientId: "A" });
    expect(a).toEqual({ ok: true, result: { sessionId: "s1" } });
    const listB = await handleBridgePayload({ op: "tools/call", name: "list_sessions", args: {}, clientId: "B" }) as
      { ok: true; result: { id: string; ownedByCaller: boolean }[] };
    expect(listB.result[0].ownedByCaller).toBe(false);
    const listA = await handleBridgePayload({ op: "tools/call", name: "list_sessions", args: {}, clientId: "A" }) as
      { ok: true; result: { id: string; ownedByCaller: boolean }[] };
    expect(listA.result[0].ownedByCaller).toBe(true);
  });

  it("rebuilds a client's tools when the contribution registry changes", async () => {
    const before = await handleBridgePayload({ op: "tools/list", clientId: "A" }) as { tools: { name: string }[] };
    expect(before.tools.map((t) => t.name)).not.toContain("p-one__a");
    registerContributions("p-one", [TOOL]);
    const after = await handleBridgePayload({ op: "tools/list", clientId: "A" }) as { tools: { name: string }[] };
    expect(after.tools.map((t) => t.name)).toContain("p-one__a");
  });

  /** The rebuild above must not orphan sessions the client already opened: a
   *  fresh `owned` set would leave them permanently unclosable. */
  it("keeps ownership across a tool rebuild", async () => {
    await handleBridgePayload({ op: "tools/call", name: "open_session", args: { connectionId: "c1" }, clientId: "A" });
    registerContributions("p-one", [TOOL]);
    const close = await handleBridgePayload({ op: "tools/call", name: "close_session", args: { sessionId: "s1" }, clientId: "A" });
    expect(close).toEqual({ ok: true, result: { closed: "s1" } });
  });

  it("drops a client's state when it disconnects", async () => {
    const open = await handleBridgePayload({ op: "tools/call", name: "open_session", args: { connectionId: "c1" }, clientId: "A" });
    expect(open).toEqual({ ok: true, result: { sessionId: "s1" } });
    const listType = (v: unknown) => v as { ok: true; result: { ownedByCaller: boolean }[] };
    const before = listType(await handleBridgePayload({ op: "tools/call", name: "list_sessions", args: {}, clientId: "A" }));
    expect(before.result[0].ownedByCaller).toBe(true);

    await handleBridgePayload({ op: "client_closed", clientId: "A" });
    const after = listType(await handleBridgePayload({ op: "tools/call", name: "list_sessions", args: {}, clientId: "A" }));
    expect(after.result[0].ownedByCaller).toBe(false);
  });
});
