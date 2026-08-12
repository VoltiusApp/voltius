import { describe, expect, it, vi } from "vitest";
import { buildTelemetryTools, TELEMETRY_PERMISSIONS } from "./telemetry";
import type { ToolSurfacePorts } from "../coreTools";

function makePorts() {
  const audit = vi.fn();
  const api = {
    appSync: {
      status: vi.fn(() => ({
        status: "success", lastSync: "2026-08-12T00:00:00.000Z",
        error: null, cloudActive: true, blobSizeBytes: 1234,
      })),
    },
    health: {
      pingStatus: vi.fn(() => [{ connectionId: "c-1", status: "up", latencyMs: 12 }]),
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
  buildTelemetryTools(ports).find((t) => t.name === name)!;

describe("telemetry permissions", () => {
  it("declares every permission it reaches", () => {
    expect([...TELEMETRY_PERMISSIONS]).toEqual(["sync:read", "health:read"]);
  });
});

describe("sync_status", () => {
  it("reads without an approval prompt or an audit row", async () => {
    const { ports, audit } = makePorts();
    expect(tool(ports, "sync_status").risk).toBe("auto");
    expect(await tool(ports, "sync_status").execute({})).toMatchObject({ status: "success", blobSizeBytes: 1234 });
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("host_ping_status", () => {
  it("returns the cached statuses", async () => {
    const { ports } = makePorts();
    expect(await tool(ports, "host_ping_status").execute({})).toEqual([
      { connectionId: "c-1", status: "up", latencyMs: 12 },
    ]);
  });

  it("says in its description that it does not probe", () => {
    const { ports } = makePorts();
    expect(tool(ports, "host_ping_status").description.toLowerCase()).toContain("does not");
  });
});
