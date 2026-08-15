import { describe, it, expect, vi } from "vitest";
import { buildImportExportTools } from "./importExport";
import type { ToolSurfacePorts } from "../coreTools";

function ports(over: { exportResult?: unknown; importResult?: unknown } = {}) {
  const audit = vi.fn();
  const writeText = vi.fn(async () => {});
  const readText = vi.fn(async () => "{}");
  const api = {
    fs: { writeText, readText },
    importExport: {
      export: vi.fn(async () => over.exportResult ?? ({ ok: true, result: { content: "{\"a\":1}", encrypted: false, counts: { connections: 1 } } })),
      import: vi.fn(async () => over.importResult ?? ({ ok: true, result: { imported: 1, errors: 0, counts: { connections: 1 }, dryRun: false } })),
    },
  };
  return {
    p: { api, approve: async () => ({ approve: true, scope: "mcp", via: "granted" }), audit } as unknown as ToolSurfacePorts,
    audit, api, writeText, readText,
  };
}

const byName = (p: ToolSurfacePorts, n: string) => buildImportExportTools(p).find((t) => t.name === n)!;

describe("import/export verbs", () => {
  it("exposes two verbs, both prompt-risk: export reads every secret the user owns", () => {
    const tools = buildImportExportTools(ports().p);
    expect(tools.map((t) => t.name)).toEqual(["export_objects", "import_objects"]);
    expect(tools.map((t) => t.risk)).toEqual(["prompt", "prompt"]);
  });

  it("returns the bundle inline when no path is given", async () => {
    const { p, writeText } = ports();
    const r = await byName(p, "export_objects").execute({ vault_ids: ["personal"], types: ["connections"] }) as { result: Record<string, unknown> };
    expect(r.result.content).toBe("{\"a\":1}");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("writes to the path and withholds the content when a path is given", async () => {
    const { p, writeText } = ports();
    const r = await byName(p, "export_objects").execute({ vault_ids: ["personal"], types: ["connections"], path: "/tmp/b.json" }) as { result: Record<string, unknown> };
    expect(writeText).toHaveBeenCalledWith("/tmp/b.json", "{\"a\":1}");
    expect(r.result.path).toBe("/tmp/b.json");
    expect(r.result.content).toBeUndefined();
  });

  it("passes an export refusal through unwrapped", async () => {
    const { p } = ports({ exportResult: { ok: false, error: "this export carries secrets (connections)" } });
    const r = await byName(p, "export_objects").execute({ vault_ids: ["personal"], types: ["connections"] }) as Record<string, unknown>;
    expect(r.refused).toBe(true);
    expect(String(r.error)).toContain("connections");
  });

  it("export_objects audits the call's shape, never the content or passphrase", async () => {
    const { p, audit } = ports();
    await byName(p, "export_objects").execute({
      vault_ids: ["personal"], types: ["connections"], passphrase: "hunter2",
    });
    expect(audit).toHaveBeenCalledWith(
      "mcp", "agent.objects_exported",
      expect.objectContaining({
        tool: "export_objects", types: ["connections"], vaultIds: ["personal"],
        encrypted: true, destination: "inline",
      }),
      undefined,
    );
    const meta = audit.mock.calls[0][2] as Record<string, unknown>;
    expect(JSON.stringify(meta)).not.toContain("hunter2");
  });

  it("import_objects reads the path when given one and audits the write", async () => {
    const { p, audit, readText } = ports();
    await byName(p, "import_objects").execute({ path: "/tmp/b.json", vault_id: "personal" });
    expect(readText).toHaveBeenCalledWith("/tmp/b.json");
    expect(audit).toHaveBeenCalledWith(
      "mcp", "agent.objects_imported",
      expect.objectContaining({ tool: "import_objects", vaultId: "personal", dryRun: false }),
      undefined,
    );
  });

  it("import_objects refuses with neither content nor path, before the gate", async () => {
    const { p, audit } = ports();
    const r = await byName(p, "import_objects").execute({ vault_id: "personal" }) as Record<string, unknown>;
    expect(r.refused).toBe(true);
    expect(audit).not.toHaveBeenCalled();
  });
});
