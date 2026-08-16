import { describe, it, expect, vi } from "vitest";
import { buildMarketplaceTools } from "./marketplace";
import type { ToolSurfacePorts } from "../coreTools";

const source = { id: "custom", name: "Custom", url: "https://x/p.json", enabled: true, deletable: true };
const builtIn = { id: "voltius", name: "Voltius", url: "https://voltius/p.json", enabled: true, deletable: false };
const tokenSource = {
  id: "http---127-0-0-1-8099-plugins-json-token-secret789",
  name: "Team", url: "http://127.0.0.1:8099/plugins.json?token=secret789", enabled: true, deletable: true,
};

function ports() {
  const audit = vi.fn();
  const api = {
    plugins: {
      search: vi.fn(async () => [{ id: "acme", name: "Acme", version: "1.0.0" }]),
      sources: vi.fn(async () => [source, builtIn, tokenSource]),
      addSource: vi.fn(async () => ({ ok: true, result: source })),
      removeSource: vi.fn(async () => ({ ok: true, result: { id: source.id } })),
    },
  };
  return {
    p: { api, approve: async () => ({ approve: true, scope: "mcp", via: "granted" }), audit } as unknown as ToolSurfacePorts,
    audit, api,
  };
}

const byName = (p: ToolSurfacePorts, n: string) => buildMarketplaceTools(p).find((t) => t.name === n)!;

describe("marketplace verbs", () => {
  it("exposes four verbs at the expected risks", () => {
    const tools = buildMarketplaceTools(ports().p);
    expect(tools.map((t) => t.name)).toEqual([
      "marketplace_search", "marketplace_source_list", "marketplace_source_add", "marketplace_source_remove",
    ]);
    expect(tools.map((t) => t.risk)).toEqual(["auto", "auto", "prompt", "prompt"]);
  });

  it("passes the query through and audits nothing", async () => {
    const { p, api, audit } = ports();
    await byName(p, "marketplace_search").execute({ query: "acme" });
    expect(api.plugins.search).toHaveBeenCalledWith("acme");
    expect(audit).not.toHaveBeenCalled();
  });

  it("audits a source addition with the origin, not the full URL", async () => {
    const { p, audit } = ports();
    expect(await byName(p, "marketplace_source_add").execute({ url: source.url }))
      .toEqual({ ok: true, result: source });
    expect(audit).toHaveBeenCalledWith(
      "mcp", "agent.marketplace_source_changed",
      expect.objectContaining({ tool: "marketplace_source_add", url: "https://x", change: "added" }),
      undefined,
    );
  });

  it("strips the query string, keeping only the origin, when the URL carries one", async () => {
    const { p, audit } = ports();
    await byName(p, "marketplace_source_add").execute({ url: "https://example.com/team/plugins.json?token=abc" });
    expect(audit).toHaveBeenCalledWith(
      "mcp", "agent.marketplace_source_changed",
      expect.objectContaining({ url: "https://example.com" }),
      undefined,
    );
    const [, , metadata] = audit.mock.calls[0];
    expect(String((metadata as Record<string, unknown>).url)).not.toContain("token");
  });

  it("refuses removing the built-in source before the gate, writing no audit row", async () => {
    const { p, audit, api } = ports();
    const r = await byName(p, "marketplace_source_remove").execute({ id: "voltius" }) as Record<string, unknown>;
    expect(r.refused).toBe(true);
    expect(String(r.error)).toContain("built in");
    expect(api.plugins.removeSource).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses removing an unknown source id before the gate, writing no audit row", async () => {
    const { p, audit, api } = ports();
    const r = await byName(p, "marketplace_source_remove").execute({ id: "no-such-source" }) as Record<string, unknown>;
    expect(r.refused).toBe(true);
    expect(String(r.error)).toContain("no-such-source");
    expect(api.plugins.removeSource).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("removes a deletable custom source and audits the origin, not the raw id", async () => {
    const { p, audit } = ports();
    const r = await byName(p, "marketplace_source_remove").execute({ id: "custom" }) as Record<string, unknown>;
    expect(r).toEqual({ ok: true, result: { id: "custom" } });
    expect(audit).toHaveBeenCalledWith(
      "mcp", "agent.marketplace_source_changed",
      expect.objectContaining({ tool: "marketplace_source_remove", sourceId: "https://x", change: "removed" }),
      undefined,
    );
  });

  it("audits a removal by origin even when the source id itself embeds a token", async () => {
    const { p, audit } = ports();
    await byName(p, "marketplace_source_remove").execute({ id: tokenSource.id });
    const [, , metadata] = audit.mock.calls[0];
    expect((metadata as Record<string, unknown>).sourceId).toBe("http://127.0.0.1:8099");
    expect(String((metadata as Record<string, unknown>).sourceId)).not.toContain("secret789");
  });
});
