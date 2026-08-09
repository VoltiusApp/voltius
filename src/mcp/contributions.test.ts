import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerContributions,
  clearContributions,
  listContributions,
  contributionsVersion,
  onContributionsChanged,
  namespaceFor,
  contributionsByPlugin,
} from "./contributions";

const ok = {
  name: "container_list",
  description: "List containers.",
  inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
  execute: async () => [],
};

describe("the contribution registry", () => {
  beforeEach(() => {
    clearContributions("plugin-docker");
    clearContributions("plugin-other");
  });

  it("strips the plugin- prefix for the namespace", () => {
    expect(namespaceFor("plugin-docker")).toBe("docker");
    expect(namespaceFor("acme-tools")).toBe("acme-tools");
  });

  it("namespaces registered tools and exposes them", () => {
    registerContributions("plugin-docker", [ok]);
    expect(listContributions().map((t) => t.name)).toEqual(["docker__container_list"]);
  });

  it("compiles the JSON Schema so bad arguments are rejected", () => {
    registerContributions("plugin-docker", [ok]);
    const tool = listContributions()[0];
    expect(tool.schema.safeParse({ sessionId: "s1" }).success).toBe(true);
    expect(tool.schema.safeParse({}).success).toBe(false);
  });

  it("defaults mutating to true", () => {
    registerContributions("plugin-docker", [ok]);
    expect(listContributions()[0].mutating).toBe(true);
    clearContributions("plugin-docker");
    registerContributions("plugin-docker", [{ ...ok, mutating: false }]);
    expect(listContributions()[0].mutating).toBe(false);
  });

  it("rejects a name outside the charset", () => {
    expect(() => registerContributions("plugin-docker", [{ ...ok, name: "Container-List" }]))
      .toThrow(/name/);
  });

  it("rejects an empty description", () => {
    expect(() => registerContributions("plugin-docker", [{ ...ok, description: "  " }]))
      .toThrow(/description/);
  });

  it("rejects a duplicate name within one set", () => {
    expect(() => registerContributions("plugin-docker", [ok, { ...ok }])).toThrow(/duplicate/);
  });

  it("rejects an unconvertible schema", () => {
    expect(() =>
      registerContributions("plugin-docker", [{ ...ok, inputSchema: { type: "nonsense" } }]),
    ).toThrow(/schema/i);
  });

  it("rejects a second plugin claiming a taken namespace", () => {
    registerContributions("plugin-docker", [ok]);
    expect(() => registerContributions("docker", [ok])).toThrow(/namespace/);
  });

  it("registers nothing at all when one tool in the set is invalid", () => {
    expect(() =>
      registerContributions("plugin-docker", [ok, { ...ok, name: "BAD" }]),
    ).toThrow();
    expect(listContributions()).toEqual([]);
  });

  it("the teardown removes the whole set and bumps the version", () => {
    const before = contributionsVersion();
    const off = registerContributions("plugin-docker", [ok]);
    expect(contributionsVersion()).toBeGreaterThan(before);
    const mid = contributionsVersion();
    off();
    expect(listContributions()).toEqual([]);
    expect(contributionsVersion()).toBeGreaterThan(mid);
  });

  it("hands out no live reference a plugin could mutate after validation", () => {
    const schema: Record<string, unknown> = { type: "object", properties: {} };
    registerContributions("plugin-docker", [{ ...ok, inputSchema: schema }]);
    schema.type = "string";
    expect(listContributions()[0].inputSchema).toEqual({ type: "object", properties: {} });

    const tools = contributionsByPlugin().get("plugin-docker")!;
    tools.length = 0;
    expect(contributionsByPlugin().get("plugin-docker")).toHaveLength(1);
  });

  it("notifies subscribers on register and on teardown", () => {
    const cb = vi.fn();
    const unsub = onContributionsChanged(cb);
    const off = registerContributions("plugin-docker", [ok]);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
    registerContributions("plugin-docker", [ok]);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
