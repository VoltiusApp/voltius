import { describe, it, expect, vi } from "vitest";
import { buildPluginTools } from "./plugins";
import type { ToolSurfacePorts } from "../coreTools";

const view = {
  id: "acme", name: "Acme", version: "1.0.0", enabled: true, loaded: true,
  origin: "catalog" as const, hash: "abc", permissions: ["storage"],
  configurable: ["autoCheck"], updateAvailable: null,
};

function ports(over: Partial<Record<string, unknown>> = {}) {
  const audit = vi.fn();
  const api = {
    plugins: {
      list: vi.fn(async () => [view]),
      install: vi.fn(async () => ({ ok: true, result: view })),
      uninstall: vi.fn(async () => ({ ok: true, result: { id: "acme" } })),
      setEnabled: vi.fn(async () => ({ ok: true, result: { ...view, enabled: false } })),
      update: vi.fn(async () => ({ ok: false, error: "already at 1.0.0" })),
      config: vi.fn(async () => ({ ok: true, result: { autoCheck: true } })),
      configure: vi.fn(async () => ({ ok: true, result: { key: "autoCheck", effective: false } })),
      ...(over.plugins as object ?? {}),
    },
  };
  return {
    p: { api, approve: async () => ({ approve: true, scope: "mcp", via: "granted" }), audit } as unknown as ToolSurfacePorts,
    audit,
    api,
  };
}

const byName = (p: ToolSurfacePorts, name: string) => buildPluginTools(p).find((t) => t.name === name)!;

describe("plugin verbs", () => {
  it("exposes seven verbs, reads at auto risk and writes at prompt risk", () => {
    const tools = buildPluginTools(ports().p);
    expect(tools.map((t) => t.name)).toEqual([
      "plugin_list", "plugin_install", "plugin_uninstall",
      "plugin_enable", "plugin_disable", "plugin_update", "plugin_configure",
    ]);
    expect(tools.find((t) => t.name === "plugin_list")!.risk).toBe("auto");
    for (const n of ["plugin_install", "plugin_uninstall", "plugin_enable", "plugin_disable", "plugin_update", "plugin_configure"]) {
      expect(tools.find((t) => t.name === n)!.risk).toBe("prompt");
    }
  });

  it("plugin_list returns the inventory", async () => {
    expect(await byName(ports().p, "plugin_list").execute({})).toEqual([view]);
  });

  it("plugin_install audits agent.plugin_installed with the tool and approval", async () => {
    const { p, audit } = ports();
    const r = await byName(p, "plugin_install").execute({ id: "acme" });
    expect(r).toEqual({ ok: true, result: view });
    expect(audit).toHaveBeenCalledWith(
      "mcp", "agent.plugin_installed",
      expect.objectContaining({ tool: "plugin_install", approval: "granted", pluginId: "acme" }),
      undefined,
    );
  });

  it("plugin_enable and plugin_disable audit distinct actions", async () => {
    const a = ports(); await byName(a.p, "plugin_enable").execute({ id: "acme" });
    expect(a.audit).toHaveBeenCalledWith("mcp", "agent.plugin_enabled", expect.anything(), undefined);
    const b = ports(); await byName(b.p, "plugin_disable").execute({ id: "acme" });
    expect(b.audit).toHaveBeenCalledWith("mcp", "agent.plugin_disabled", expect.anything(), undefined);
  });

  it("passes a domain refusal through unwrapped rather than as a success", async () => {
    const r = await byName(ports().p, "plugin_update").execute({ id: "acme" }) as Record<string, unknown>;
    expect(r.refused).toBe(true);
    expect(r.ok).toBeUndefined();
  });

  it("plugin_configure without a value reads the declared configuration and raises no card", async () => {
    const { p, audit, api } = ports();
    expect(await byName(p, "plugin_configure").execute({ id: "acme" }))
      .toEqual({ autoCheck: true });
    expect(api.plugins.configure).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("plugin_configure with a value writes and audits", async () => {
    const { p, audit } = ports();
    expect(await byName(p, "plugin_configure").execute({ id: "acme", key: "autoCheck", value: false }))
      .toEqual({ ok: true, result: { key: "autoCheck", effective: false } });
    expect(audit).toHaveBeenCalledWith(
      "mcp", "agent.plugin_configured",
      expect.objectContaining({ tool: "plugin_configure", pluginId: "acme", key: "autoCheck" }),
      undefined,
    );
  });

  it("plugin_configure refuses a value without a key before the gate", async () => {
    const { p, audit } = ports();
    const r = await byName(p, "plugin_configure").execute({ id: "acme", value: false }) as Record<string, unknown>;
    expect(r.refused).toBe(true);
    expect(audit).not.toHaveBeenCalled();
  });

  it("plugin_configure refuses an undeclared key before the gate, writing no audit row", async () => {
    const { p, audit, api } = ports();
    const r = await byName(p, "plugin_configure").execute({ id: "acme", key: "nope", value: 1 }) as Record<string, unknown>;
    expect(r.refused).toBe(true);
    expect(String(r.error)).toContain("nope");
    expect(api.plugins.configure).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  // A typo'd id is doomed regardless of approval: the domain guard still
  // refuses it, but the pre-check here must catch it first so no approval
  // card is raised and no audit row is written for something that never ran.
  for (const name of [
    "plugin_uninstall",
    "plugin_update",
    "plugin_enable",
    "plugin_disable",
  ] as const) {
    it(`${name} on an unknown id is refused before the gate, writing no audit row`, async () => {
      const { p, audit, api } = ports();
      const r = await byName(p, name).execute({ id: "no-such-plugin" }) as Record<string, unknown>;
      expect(r.refused).toBe(true);
      expect(String(r.error)).toContain("no-such-plugin");
      expect(audit).not.toHaveBeenCalled();
      expect(api.plugins.uninstall).not.toHaveBeenCalled();
      expect(api.plugins.update).not.toHaveBeenCalled();
      expect(api.plugins.setEnabled).not.toHaveBeenCalled();
    });
  }
});
