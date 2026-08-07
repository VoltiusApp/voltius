import { describe, it, expect, vi, beforeEach } from "vitest";

const listeners = new Map<string, (e: { payload: unknown }) => void>();
const invoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    listeners.set(name, cb);
    return () => listeners.delete(name);
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("./hostApi", () => ({
  getMcpHostApi: () => ({
    connections: { list: async () => [{ id: "c1", name: "Prod", host: "h1" }] },
    sessions: { list: () => [] },
    audit: { record: vi.fn() },
  }),
}));

import { registerMcpConsumer } from "./register";

const replyCall = () => invoke.mock.calls.find((c) => c[0] === "mcp_bridge_reply") as
  [string, { id: string; result: { tools?: unknown[]; ok?: boolean; result?: unknown; error?: string } }];

const fire = async (payload: unknown) => {
  listeners.get("mcp-bridge-request")?.({ payload });
  await vi.waitFor(() => expect(replyCall()).toBeTruthy());
};

beforeEach(() => { listeners.clear(); invoke.mockClear(); });

describe("MCP bridge listener", () => {
  it("answers a tools/list request with the tool descriptors", async () => {
    registerMcpConsumer();
    await vi.waitFor(() => expect(listeners.has("mcp-bridge-request")).toBe(true));
    await fire({ id: "r1", payload: { op: "tools/list" } });

    const [cmd, args] = replyCall();
    expect(cmd).toBe("mcp_bridge_reply");
    expect(args.id).toBe("r1");
    expect(args.result.tools).toHaveLength(2);
  });

  it("answers a tools/call request with the tool's real result", async () => {
    registerMcpConsumer();
    await vi.waitFor(() => expect(listeners.has("mcp-bridge-request")).toBe(true));
    await fire({ id: "r2", payload: { op: "tools/call", name: "list_connections", args: {} } });

    const [, args] = replyCall();
    expect(args.result).toEqual({ ok: true, result: [{ id: "c1", name: "Prod", host: "h1" }] });
  });

  it("always replies, even for an unrecognised op — an unanswered request hangs the client", async () => {
    registerMcpConsumer();
    await vi.waitFor(() => expect(listeners.has("mcp-bridge-request")).toBe(true));
    await fire({ id: "r3", payload: { op: "nonsense" } });

    const [, args] = replyCall();
    expect(args.id).toBe("r3");
    expect(args.result.ok).toBe(false);
  });

  it("signals the backend once its listener is attached, on every (re)registration", async () => {
    registerMcpConsumer();
    await vi.waitFor(() =>
      expect(invoke.mock.calls.some((c) => c[0] === "mcp_consumer_ready")).toBe(true),
    );
  });
});
