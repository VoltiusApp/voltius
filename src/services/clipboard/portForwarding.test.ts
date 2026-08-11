import { describe, expect, it, vi } from "vitest";
import { portForwardingClipboardHalf, type PortForwardingClipboardDeps } from "./portForwarding";
import type { PortForwardingRule } from "@/types";

const rule = (over: Partial<PortForwardingRule> = {}): PortForwardingRule =>
  ({
    id: "r1", name: "rule", vault_id: "personal", folder_id: null, connection_ids: ["c1"], ...over,
  }) as unknown as PortForwardingRule;

const deps = (over: Partial<PortForwardingClipboardDeps> = {}): PortForwardingClipboardDeps =>
  ({
    rules: [rule()],
    connections: [{ id: "c1", vault_id: "personal" }],
    getRulesInFolderTree: () => [],
    vaultForFolder: () => "personal",
    moveRuleFolder: vi.fn(async () => {}),
    updateRule: vi.fn(async () => {}),
    duplicateRuleInto: vi.fn(async () => ({ id: "copy" })),
    deleteRule: vi.fn(async () => {}),
    ...over,
  }) as PortForwardingClipboardDeps;

describe("portForwardingClipboardHalf", () => {
  it("reports a connection left behind in another vault as dangling", () => {
    const half = portForwardingClipboardHalf(deps());
    expect(half.danglingKinds!([{ id: "r1", kind: "port_forward" }], [], "team-1"))
      .toEqual(["connection"]);
  });

  it("reports nothing when the tunnelled host is already in the destination", () => {
    const half = portForwardingClipboardHalf(
      deps({ connections: [{ id: "c1", vault_id: "team-1" }] } as Partial<PortForwardingClipboardDeps>),
    );
    expect(half.danglingKinds!([{ id: "r1", kind: "port_forward" }], [], "team-1")).toEqual([]);
  });

  it("only reparents a same-vault move", async () => {
    const d = deps();
    await portForwardingClipboardHalf(d).moveItems(["r1"], "f2", "personal");
    expect(d.moveRuleFolder).toHaveBeenCalledWith("r1", "f2");
    expect(d.updateRule).not.toHaveBeenCalled();
  });

  it("changes vault through updateRule on a cross-vault move", async () => {
    const d = deps();
    await portForwardingClipboardHalf(d).moveItems(["r1"], "f2", "team-1");
    expect(d.updateRule).toHaveBeenCalledWith(
      "r1", expect.objectContaining({ folder_id: "f2", vault_id: "team-1" }),
    );
    expect(d.moveRuleFolder).not.toHaveBeenCalled();
  });

  it("returns the ids of the duplicates it created", async () => {
    expect(await portForwardingClipboardHalf(deps()).duplicateItems(["r1"], null)).toEqual(["copy"]);
  });
});
