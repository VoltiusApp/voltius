import { describe, it, expect } from "vitest";
import { resolveObjectRef } from "./objectRefs";
import type { PluginConnection } from "@/plugins/api";

const conn = (over: Partial<PluginConnection> = {}): PluginConnection => ({
  id: "c1", name: "Prod DB", host: "10.0.0.1", port: 22, username: "root",
  auth_type: "key", tags: [], ...over,
});

describe("resolveObjectRef", () => {
  it("resolves a known id to name + endpoint", () => {
    const ref = resolveObjectRef("c1", [conn()]);
    expect(ref).toEqual({
      kind: "connection", id: "c1", name: "Prod DB",
      detail: "root@10.0.0.1:22", ambiguous: false, connection: conn(),
    });
  });

  it("returns null for an unknown id", () => {
    expect(resolveObjectRef("nope", [conn()])).toBeNull();
  });

  it("falls back to user@host:port as the name when unnamed", () => {
    const ref = resolveObjectRef("c1", [conn({ name: undefined })]);
    expect(ref?.name).toBe("root@10.0.0.1:22");
  });
});

describe("resolveObjectRef — duplicate display names (#76)", () => {
  it("marks a ref ambiguous when another connection shares its display name", () => {
    const list = [conn(), conn({ id: "c2", host: "10.0.0.2" })];
    expect(resolveObjectRef("c1", list)?.ambiguous).toBe(true);
    expect(resolveObjectRef("c2", list)?.ambiguous).toBe(true);
  });

  it("leaves a uniquely-named connection unambiguous", () => {
    const list = [conn(), conn({ id: "c2", name: "Staging DB" })];
    expect(resolveObjectRef("c1", list)?.ambiguous).toBe(false);
  });
});
