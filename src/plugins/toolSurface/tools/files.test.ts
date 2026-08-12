import { describe, expect, it, vi } from "vitest";
import { buildFileTools, FILE_PERMISSIONS } from "./files";
import type { ToolSurfacePorts } from "../coreTools";

function makePorts(overrides: Record<string, unknown> = {}) {
  const audit = vi.fn();
  const api = {
    sftp: {
      list: vi.fn(), stat: vi.fn(), readText: vi.fn(), mkdir: vi.fn(),
      writeText: vi.fn(), rename: vi.fn(), delete: vi.fn(),
      transfer: vi.fn(async () => undefined),
    },
  };
  const ports = {
    api,
    approve: async ({ args }: { args: Record<string, unknown> }) => ({ approve: true, scope: "mcp", via: "granted", args }),
    audit,
    owned: new Set<string>(),
    ...overrides,
  } as unknown as ToolSurfacePorts;
  return { ports, api, audit };
}

const tool = (ports: ToolSurfacePorts, name: string) =>
  buildFileTools(ports).find((t) => t.name === name)!;

describe("file permissions", () => {
  it("declares every permission it reaches", () => {
    expect([...FILE_PERMISSIONS]).toEqual(["sftp:read", "sftp:write", "audit"]);
  });
});

describe("transfer_file", () => {
  it("obtains the transfer id via ports.transferId, not a direct import", async () => {
    const transferId = vi.fn(() => "row-1");
    const { ports, api } = makePorts({ transferId });
    const raw = { fromTarget: "local", fromPath: "/a", toTarget: "c-1", toPath: "/b" };
    await tool(ports, "transfer_file").execute(raw);
    expect(transferId).toHaveBeenCalledWith(raw);
    expect(api.sftp.transfer).toHaveBeenCalledWith(
      { target: "local", path: "/a" },
      { target: "c-1", path: "/b" },
      "row-1",
    );
  });

  it("works when the consumer supplies no transferId port at all", async () => {
    const { ports, api } = makePorts();
    await tool(ports, "transfer_file").execute({
      fromTarget: "local", fromPath: "/a", toTarget: "c-1", toPath: "/b",
    });
    expect(api.sftp.transfer).toHaveBeenCalledWith(
      { target: "local", path: "/a" },
      { target: "c-1", path: "/b" },
      undefined,
    );
  });
});

/**
 * Guards the layering fix directly: the host-agnostic tool surface must reach
 * MCP-specific state only through `ports`, never by importing a consumer's
 * module. A value import here would work today because everything resolves
 * inside one bundle, and break silently once `@voltius/tools` ships apart
 * from the app that consumes it.
 */
describe("layering", () => {
  it("src/plugins/toolSurface has no import from @/mcp", () => {
    const sources = import.meta.glob("../**/*.{ts,tsx}", { eager: true, query: "?raw", import: "default" }) as
      Record<string, string>;
    const offenders = Object.entries(sources)
      .filter(([, text]) => /from\s+["']@\/mcp/.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
