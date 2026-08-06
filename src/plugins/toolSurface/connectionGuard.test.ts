import { describe, it, expect, vi } from "vitest";
import type { PluginAPI } from "@/plugins/api";
import {
  MAX_LISTED_CONNECTIONS,
  guardConnectionId,
  guardPlanConnectionIds,
} from "./connectionGuard";

const conn = (id: string, name?: string) => ({
  id,
  name,
  host: `${id}.example`,
  port: 22,
  username: "u",
  auth_type: "key" as const,
  tags: [],
});

function api(list: unknown): Pick<PluginAPI, "connections"> {
  return { connections: { list } } as unknown as Pick<PluginAPI, "connections">;
}

const ok = api(vi.fn(async () => [conn("conn-A", "srv"), conn("conn-B")]));

describe("guardConnectionId", () => {
  it("accepts a real connection id", async () => {
    expect(await guardConnectionId(ok, "conn-A")).toEqual({ ok: true });
  });

  it("rejects a host name and names the valid ids", async () => {
    const r = await guardConnectionId(ok, "conn-A.example");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(String(r.result.error)).toContain("conn-A.example");
    expect(String(r.result.error)).toContain("list_connections");
    expect(r.result.connections).toEqual([
      { id: "conn-A", name: "srv", host: "conn-A.example" },
      { id: "conn-B", name: undefined, host: "conn-B.example" },
    ]);
  });

  it("rejects an empty id", async () => {
    expect((await guardConnectionId(ok, "")).ok).toBe(false);
  });

  it("omits the connection list above the cap", async () => {
    const many = api(vi.fn(async () => Array.from({ length: MAX_LISTED_CONNECTIONS + 1 }, (_, i) => conn(`c${i}`))));
    const r = await guardConnectionId(many, "nope");
    if (r.ok) throw new Error("unreachable");
    expect(r.result.connections).toBeUndefined();
  });

  it("includes the connection list AT the cap (non-vacuity partner)", async () => {
    const atCap = api(vi.fn(async () => Array.from({ length: MAX_LISTED_CONNECTIONS }, (_, i) => conn(`c${i}`))));
    const r = await guardConnectionId(atCap, "nope");
    if (r.ok) throw new Error("unreachable");
    expect((r.result.connections as unknown[]).length).toBe(MAX_LISTED_CONNECTIONS);
  });

  it("fails closed when the connection list throws", async () => {
    const boom = api(vi.fn(async () => {
      throw new Error("nope");
    }));
    const r = await guardConnectionId(boom, "conn-A");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.result.connections).toBeUndefined();
  });
});

describe("guardPlanConnectionIds", () => {
  it("accepts when every id is real", async () => {
    expect(await guardPlanConnectionIds(ok, ["conn-A", "conn-B", "conn-A"])).toEqual({ ok: true });
  });

  it("reports the distinct unknown ids in first-appearance order", async () => {
    const r = await guardPlanConnectionIds(ok, ["zeta", "conn-A", "alpha", "zeta"]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.result.unknownConnectionIds).toEqual(["zeta", "alpha"]);
    expect(String(r.result.error)).toContain("list_connections");
    expect((r.result.connections as unknown[]).length).toBe(2);
  });

  it("accepts an empty step list", async () => {
    expect(await guardPlanConnectionIds(ok, [])).toEqual({ ok: true });
  });

  it("fails closed when the connection list throws", async () => {
    const boom = api(vi.fn(async () => {
      throw new Error("nope");
    }));
    const r = await guardPlanConnectionIds(boom, ["conn-A"]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.result.unknownConnectionIds).toEqual(["conn-A"]);
  });
});
