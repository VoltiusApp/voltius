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
      detail: "root@10.0.0.1:22", connection: conn(),
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
