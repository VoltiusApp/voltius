import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));

const execute = vi.fn(async () => ({ ok: true }));
vi.mock("./consumer", () => ({
  buildMcpTools: (_api: unknown, owned: {
    has: (id: string) => boolean;
    add: (id: string) => void;
    acquire?: (id: string) => boolean;
  }) => [
    { name: "open_session", schema: { safeParse: (a: unknown) => ({ success: true, data: a }) },
      execute: async () => { owned.add("s1"); return { sessionId: "s1" }; } },
    { name: "run_command", schema: { safeParse: (a: unknown) => ({ success: true, data: a }) },
      execute },
    { name: "claim_probe", schema: { safeParse: (a: unknown) => ({ success: true, data: a }) },
      execute: async (a: { sessionId: string }) => ({ acquired: owned.acquire!(a.sessionId) }) },
    { name: "list_probe", schema: { safeParse: (a: unknown) => ({ success: true, data: a }) },
      execute: async (a: { sessionId: string }) => ({ owned: owned.has(a.sessionId) }) },
  ],
  listToolDescriptors: (tools: { name: string }[]) => tools.map((t) => ({ name: t.name })),
  callTool: async (tools: { name: string; execute: (a: unknown) => Promise<unknown> }[], name: string, args: unknown) => {
    const tool = tools.find((t) => t.name === name);
    return { ok: true, result: await tool!.execute(args) };
  },
}));
vi.mock("./hostApi", () => ({ getMcpHostApi: () => ({}) }));
vi.mock("./contributions", () => ({ contributionsVersion: () => 1 }));
vi.mock("./notifyToolsChanged", () => ({ startToolsChangedNotifier: () => () => {} }));

import { handleBridgePayload, resetClientTools } from "./register";
import { useMcpOwnershipStore } from "@/stores/mcpOwnershipStore";

beforeEach(() => {
  resetClientTools();
  useMcpOwnershipStore.setState({ owners: {}, busy: {} });
  execute.mockClear();
  execute.mockImplementation(async () => ({ ok: true }));
});

describe("bridge ownership", () => {
  it("a tool adding to owned claims the session with the client name", async () => {
    await handleBridgePayload({
      op: "tools/call", name: "open_session", args: {},
      clientId: "c1", clientName: "Claude Code",
    });
    expect(useMcpOwnershipStore.getState().owners.s1).toMatchObject({
      clientId: "c1", clientName: "Claude Code",
    });
  });

  it("falls back when the client sends no name", async () => {
    await handleBridgePayload({ op: "tools/call", name: "open_session", args: {}, clientId: "c1" });
    expect(useMcpOwnershipStore.getState().owners.s1.clientName).toBe("");
  });

  it("client_closed orphans that client's claims rather than dropping them", async () => {
    await handleBridgePayload({ op: "tools/call", name: "open_session", args: {}, clientId: "c1" });
    await handleBridgePayload({ op: "client_closed", clientId: "c1" });
    expect(useMcpOwnershipStore.getState().owners.s1).toMatchObject({ clientId: null });
  });

  it("marks the session busy for the duration of a call and clears it after", async () => {
    vi.useFakeTimers();
    let seen = -1;
    execute.mockImplementation(async () => {
      seen = useMcpOwnershipStore.getState().busy.s9 ?? 0;
      return { ok: true };
    });
    await handleBridgePayload({
      op: "tools/call", name: "run_command", args: { sessionId: "s9" }, clientId: "c1",
    });
    await vi.runAllTimersAsync();
    expect(seen).toBe(1);
    expect(useMcpOwnershipStore.getState().busy.s9).toBeUndefined();
    vi.useRealTimers();
  });

  it("clears busy even when the tool throws", async () => {
    vi.useFakeTimers();
    execute.mockImplementation(async () => { throw new Error("boom"); });
    await handleBridgePayload({
      op: "tools/call", name: "run_command", args: { sessionId: "s9" }, clientId: "c1",
    }).catch(() => {});
    await vi.runAllTimersAsync();
    expect(useMcpOwnershipStore.getState().busy.s9).toBeUndefined();
    vi.useRealTimers();
  });

  it("ignores a call with no sessionId argument", async () => {
    vi.useFakeTimers();
    await handleBridgePayload({ op: "tools/call", name: "run_command", args: {}, clientId: "c1" });
    await vi.runAllTimersAsync();
    expect(useMcpOwnershipStore.getState().busy).toEqual({});
    vi.useRealTimers();
  });

  it("a different client adopts an orphaned session on a write", async () => {
    await handleBridgePayload({ op: "tools/call", name: "open_session", args: {}, clientId: "c1" });
    await handleBridgePayload({ op: "client_closed", clientId: "c1" });
    await handleBridgePayload({
      op: "tools/call", name: "claim_probe", args: { sessionId: "s1" },
      clientId: "c2", clientName: "Second",
    });
    expect(useMcpOwnershipStore.getState().owners.s1).toMatchObject({
      clientId: "c2", clientName: "Second",
    });
  });

  it("a live client cannot take another live client's session", async () => {
    await handleBridgePayload({ op: "tools/call", name: "open_session", args: {}, clientId: "c1" });
    const result = await handleBridgePayload({
      op: "tools/call", name: "claim_probe", args: { sessionId: "s1" }, clientId: "c2",
    });
    expect(result).toMatchObject({ result: { acquired: false } });
    expect(useMcpOwnershipStore.getState().owners.s1).toMatchObject({ clientId: "c1" });
  });

  it("a session with no owner row is never adoptable", async () => {
    const result = await handleBridgePayload({
      op: "tools/call", name: "claim_probe", args: { sessionId: "user-session" }, clientId: "c2",
    });
    expect(result).toMatchObject({ result: { acquired: false } });
    expect(useMcpOwnershipStore.getState().owners["user-session"]).toBeUndefined();
  });

  it("a listing does not adopt an orphan", async () => {
    await handleBridgePayload({ op: "tools/call", name: "open_session", args: {}, clientId: "c1" });
    await handleBridgePayload({ op: "client_closed", clientId: "c1" });
    await handleBridgePayload({
      op: "tools/call", name: "list_probe", args: { sessionId: "s1" }, clientId: "c2",
    });
    expect(useMcpOwnershipStore.getState().owners.s1).toMatchObject({ clientId: null });
  });
});
