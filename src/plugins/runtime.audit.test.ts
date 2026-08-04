import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { useConnectionStore } from "@/stores/connectionStore";
import type { Connection } from "@/types";
import type { PluginAPI, PluginManifest, PluginRegisterFn } from "./api";

const reportPluginAuditEvent = vi.fn();
vi.mock("@/services/auditReporter", async (orig) => ({
  ...(await orig<typeof import("@/services/auditReporter")>()),
  reportPluginAuditEvent: (...args: Parameters<typeof reportPluginAuditEvent>) => reportPluginAuditEvent(...args),
}));
vi.mock("@/services/auditContextResolver", () => ({
  auditContextForVaultId: (vaultId?: string | null) =>
    vaultId === "team-vault" ? { kind: "team", teamId: "t1" } : { kind: "local", vaultId: vaultId || "personal" },
}));

const { loadPlugin, unloadPlugin } = await import("./runtime");

function manifest(id: string, perms: string[]): PluginManifest {
  return { id, name: id, version: "1", permissions: perms };
}

function conn(id: string, vault_id: string): Connection {
  return { id, name: id, host: "h", port: 22, username: "u", vault_id } as Connection;
}

function load(id: string, perms: string[]): PluginAPI {
  let api!: PluginAPI;
  const register: PluginRegisterFn = (a) => { api = a; };
  loadPlugin(manifest(id, perms), register, true, false);
  return api;
}

beforeEach(() => {
  reportPluginAuditEvent.mockClear();
  useConnectionStore.setState({ connections: [conn("c1", "personal")], teamConnections: { t1: [conn("c2", "team-vault")] } });
});

afterEach(() => {
  try { unloadPlugin("agent"); } catch { /* noop */ }
});

describe("api.audit.record", () => {
  test("throws without the audit permission", () => {
    const api = load("agent", []);
    expect(() => api.audit.record("c1", "agent.command_run")).toThrow(/audit/);
  });

  test("rejects an action outside the closed vocabulary", () => {
    const api = load("agent", ["audit"]);
    expect(() =>
      api.audit.record("c1", "connection.deleted" as never),
    ).toThrow(/action/i);
    expect(reportPluginAuditEvent).not.toHaveBeenCalled();
  });

  test("resolves a team-vault connection to a team context", () => {
    load("agent", ["audit"]).audit.record("c2", "agent.command_run");
    expect(reportPluginAuditEvent.mock.calls[0][0]).toEqual({ kind: "team", teamId: "t1" });
  });

  test("an unknown or null connection fails closed to local personal", () => {
    const api = load("agent", ["audit"]);
    api.audit.record("does-not-exist", "agent.command_run");
    api.audit.record(null, "agent.session_opened");
    expect(reportPluginAuditEvent.mock.calls[0][0]).toEqual({ kind: "local", vaultId: "personal" });
    expect(reportPluginAuditEvent.mock.calls[1][0]).toEqual({ kind: "local", vaultId: "personal" });
  });

  test("stamps plugin_id host-side over a caller-supplied value", () => {
    load("agent", ["audit"]).audit.record("c1", "agent.command_run", { plugin_id: "not-me", x: 1 });
    expect(reportPluginAuditEvent.mock.calls[0][2].metadata).toEqual({ x: 1, plugin_id: "agent" });
  });

  test("sets target_type to plugin and target_name to the connection name", () => {
    load("agent", ["audit"]).audit.record("c1", "agent.command_run");
    const opts = reportPluginAuditEvent.mock.calls[0][2];
    expect(opts.target_type).toBe("plugin");
    expect(opts.target_id).toBe("c1");
    expect(opts.target_name).toBe("c1");
  });

  test("truncates an oversize localMetadata string and flags it", () => {
    const long = "x".repeat(2500);
    load("agent", ["audit"]).audit.record("c1", "agent.command_run", undefined, { command: long });
    const local = reportPluginAuditEvent.mock.calls[0][2].localMetadata;
    expect(local.command).toHaveLength(2000);
    expect(local.command_truncated).toBe(true);
  });

  test("leaves an in-budget localMetadata string untouched and unflagged", () => {
    load("agent", ["audit"]).audit.record("c1", "agent.command_run", undefined, { command: "ls" });
    const local = reportPluginAuditEvent.mock.calls[0][2].localMetadata;
    expect(local.command).toBe("ls");
    expect(local.command_truncated).toBeUndefined();
  });
});
