import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleBridgePayload, resetClientTools } from "./register";
import { registerContributions, clearContributions } from "./contributions";
import { useMcpOwnershipStore } from "@/stores/mcpOwnershipStore";

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
    useMcpOwnershipStore.setState({ owners: {}, busy: {} });
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

  /** A tool rebuild must not disturb per-client ownership: the owning client
   *  can still close the session, and a different client is still refused —
   *  confirmed against a rebuild that actually happened (the contributed tool
   *  is present), not merely one that was requested. */
  it("keeps per-client ownership intact across a tool rebuild", async () => {
    await handleBridgePayload({ op: "tools/call", name: "open_session", args: { connectionId: "c1" }, clientId: "A" });
    registerContributions("p-one", [TOOL]);
    const listedAfter = await handleBridgePayload({ op: "tools/list", clientId: "A" }) as { tools: { name: string }[] };
    expect(listedAfter.tools.map((t) => t.name)).toContain("p-one__a");

    const closeByOther = await handleBridgePayload({ op: "tools/call", name: "close_session", args: { sessionId: "s1" }, clientId: "B" });
    expect(closeByOther).toMatchObject({ ok: false });

    const closeByOwner = await handleBridgePayload({ op: "tools/call", name: "close_session", args: { sessionId: "s1" }, clientId: "A" });
    expect(closeByOwner).toEqual({ ok: true, result: { closed: "s1" } });
  });

  // Uses a clientId no earlier case in this file touches, so a leftover claim
  // from an earlier test (the store isn't reset by resetClientTools) would
  // show up as a false positive here rather than being masked by id reuse.
  it("drops a client's state when it disconnects", async () => {
    const open = await handleBridgePayload({ op: "tools/call", name: "open_session", args: { connectionId: "c1" }, clientId: "C" });
    expect(open).toEqual({ ok: true, result: { sessionId: "s1" } });
    const listType = (v: unknown) => v as { ok: true; result: { ownedByCaller: boolean }[] };
    const before = listType(await handleBridgePayload({ op: "tools/call", name: "list_sessions", args: {}, clientId: "C" }));
    expect(before.result[0].ownedByCaller).toBe(true);

    await handleBridgePayload({ op: "client_closed", clientId: "C" });
    const after = listType(await handleBridgePayload({ op: "tools/call", name: "list_sessions", args: {}, clientId: "C" }));
    expect(after.result[0].ownedByCaller).toBe(false);
  });
});
