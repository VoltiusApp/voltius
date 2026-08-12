import { describe, expect, it, vi } from "vitest";
import { buildTransferTools, TRANSFER_PERMISSIONS } from "./transfers";
import type { ToolSurfacePorts } from "../coreTools";

function makePorts(overrides: Record<string, unknown> = {}) {
  const audit = vi.fn();
  const api = {
    transfers: {
      list: vi.fn(() => [
        { id: "t-1", label: "a.txt", direction: "→", status: "running", transferred: 5, total: 10 },
      ]),
      cancel: vi.fn(() => true),
      retry: vi.fn(() => true),
      ...overrides,
    },
  };
  const ports = {
    api,
    approve: async ({ args }: { args: Record<string, unknown> }) => ({ approve: true, scope: "mcp", via: "granted", args }),
    audit,
    owned: new Set<string>(),
  } as unknown as ToolSurfacePorts;
  return { ports, api, audit };
}

const tool = (ports: ToolSurfacePorts, name: string) =>
  buildTransferTools(ports).find((t) => t.name === name)!;

describe("transfer permissions", () => {
  it("declares every permission it reaches", () => {
    expect([...TRANSFER_PERMISSIONS]).toEqual(["transfers:read", "transfers:write"]);
  });
});

describe("transfer_list", () => {
  it("reads without an approval prompt or an audit row", async () => {
    const { ports, audit } = makePorts();
    expect(tool(ports, "transfer_list").risk).toBe("auto");
    expect(await tool(ports, "transfer_list").execute({})).toHaveLength(1);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("transfer_cancel", () => {
  it("prompts, records, and cancels by id", async () => {
    const { ports, api, audit } = makePorts();
    expect(tool(ports, "transfer_cancel").risk).toBe("prompt");
    expect(await tool(ports, "transfer_cancel").execute({ id: "t-1" })).toEqual({ ok: true, result: null });
    expect(api.transfers.cancel).toHaveBeenCalledWith("t-1");
    expect(audit).toHaveBeenCalled();
  });

  it("refuses rather than relabelling a transfer that is not running", async () => {
    const { ports } = makePorts({ cancel: vi.fn(() => false) });
    const result = await tool(ports, "transfer_cancel").execute({ id: "t-1" }) as { refused: true; error: string };
    expect(result.refused).toBe(true);
    expect(result.error.length).toBeGreaterThan(0);
  });
});

describe("transfer_retry", () => {
  it("retries by id", async () => {
    const { ports, api } = makePorts();
    expect(await tool(ports, "transfer_retry").execute({ id: "t-1" })).toEqual({ ok: true, result: null });
    expect(api.transfers.retry).toHaveBeenCalledWith("t-1");
  });

  it("refuses rather than silently succeeding when the transfer cannot be retried", async () => {
    const { ports } = makePorts({ retry: vi.fn(() => false) });
    const result = await tool(ports, "transfer_retry").execute({ id: "t-1" }) as { refused: true; error: string };
    expect(result.refused).toBe(true);
    expect(result.error).toEqual(expect.any(String));
    expect(result.error.length).toBeGreaterThan(0);
  });
});
