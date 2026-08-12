import { describe, expect, it, vi } from "vitest";
import { createKnownHostsAPI, type KnownHostPorts } from "./knownHosts";

const entry = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "kh-1", host: "h1", port: 22, fingerprint: "SHA256:aaa",
  vault_id: "personal", created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z", clocks: {}, name: undefined, deleted_at: undefined,
  ...over,
});

function makePorts(over: Partial<KnownHostPorts> = {}) {
  const ports: KnownHostPorts = {
    list: vi.fn(async () => [entry(), entry({ id: "kh-2", host: "h2", port: 2222 })]),
    remove: vi.fn(async () => undefined),
    trust: vi.fn(async () => ({ entry: entry({ id: "kh-3", fingerprint: "SHA256:new" }), superseded: [] })),
    isTeamVault: vi.fn(() => false),
    ...over,
  };
  return ports;
}

describe("knownHosts domain", () => {
  it("projects only the fields the surface exposes", async () => {
    const api = createKnownHostsAPI(makePorts());
    expect(await api.list()).toEqual([
      { id: "kh-1", host: "h1", port: 22, fingerprint: "SHA256:aaa", vault_id: "personal", created_at: "2026-01-01T00:00:00Z" },
      { id: "kh-2", host: "h2", port: 2222, fingerprint: "SHA256:aaa", vault_id: "personal", created_at: "2026-01-01T00:00:00Z" },
    ]);
  });

  it("filters by host and port", async () => {
    const api = createKnownHostsAPI(makePorts());
    expect(await api.list({ host: "h2" })).toHaveLength(1);
    expect(await api.list({ host: "h1", port: 2222 })).toHaveLength(0);
  });

  it("reports whether a trust replaced anything", async () => {
    const ports = makePorts({
      trust: vi.fn(async () => ({
        entry: entry({ id: "kh-9", fingerprint: "SHA256:new" }),
        superseded: [entry({ fingerprint: "SHA256:old" })],
      })),
    });
    const api = createKnownHostsAPI(ports);
    const res = await api.trust({ host: "h1", port: 22, fingerprint: "SHA256:new", replace: true });
    expect(res.replaced).toBe(true);
    expect(res.superseded.map((s) => s.fingerprint)).toEqual(["SHA256:old"]);
  });

  it("refuses a team vault", async () => {
    const ports = makePorts({ isTeamVault: vi.fn(() => true) });
    const api = createKnownHostsAPI(ports);
    await expect(api.trust({ host: "h1", port: 22, fingerprint: "x", vaultId: "team-1" }))
      .rejects.toThrow(/team vault/i);
    expect(ports.trust).not.toHaveBeenCalled();
  });
});
