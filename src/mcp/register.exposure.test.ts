import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleBridgePayload, resetClientTools } from "./register";
import { registerContributions, clearContributions } from "./contributions";
import { setPluginExposed, useMcpContributionStore } from "@/stores/mcpContributionStore";

vi.mock("./hostApi", () => ({
  getMcpHostApi: () => ({
    sessions: { list: () => [], open: async () => "s1", close: async () => {} },
    audit: { record: vi.fn() },
    connections: { list: async () => [] },
  }),
}));

const TOOL = { name: "a", description: "A.", inputSchema: { type: "object" }, execute: async () => 1 };

/** Asserted through handleBridgePayload, not buildMcpTools: the bug is that a
 *  CONNECTED client keeps a cached tool list, which a fresh build never has. */
describe("the per-plugin exposure toggle, against a connected client", () => {
  beforeEach(() => {
    resetClientTools();
    clearContributions("p-one");
    useMcpContributionStore.setState({ exposed: {} });
  });

  it("drops the verb from a second tools/list on the same client", async () => {
    registerContributions("p-one", [TOOL]);
    const before = await handleBridgePayload({ op: "tools/list", clientId: "A" }) as { tools: { name: string }[] };
    expect(before.tools.map((t) => t.name)).toContain("p-one__a");

    setPluginExposed("p-one", false);
    const after = await handleBridgePayload({ op: "tools/list", clientId: "A" }) as { tools: { name: string }[] };
    expect(after.tools.map((t) => t.name)).not.toContain("p-one__a");
  });

  it("refuses a tools/call of the verb on a client that already listed it", async () => {
    registerContributions("p-one", [TOOL]);
    await handleBridgePayload({ op: "tools/list", clientId: "A" });

    setPluginExposed("p-one", false);
    const res = await handleBridgePayload({ op: "tools/call", name: "p-one__a", args: {}, clientId: "A" });
    expect(res).toEqual({ ok: false, error: 'unknown tool "p-one__a"' });
  });

  it("restores the verb when the toggle goes back on", async () => {
    registerContributions("p-one", [TOOL]);
    setPluginExposed("p-one", false);
    await handleBridgePayload({ op: "tools/list", clientId: "A" });
    setPluginExposed("p-one", true);
    const after = await handleBridgePayload({ op: "tools/list", clientId: "A" }) as { tools: { name: string }[] };
    expect(after.tools.map((t) => t.name)).toContain("p-one__a");
  });
});

describe("a payload with no clientId", () => {
  beforeEach(resetClientTools);

  it("is refused rather than sharing one bucket across clients", async () => {
    expect(await handleBridgePayload({ op: "tools/list" })).toEqual({ ok: false, error: "missing clientId" });
    expect(await handleBridgePayload({ op: "client_closed" })).toEqual({ ok: false, error: "missing clientId" });
  });
});
