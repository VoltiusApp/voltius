import { describe, expect, it } from "vitest";
import type { Connection, Identity, PortForwardingRule, Snippet, SshKey } from "@/types";
import {
  linksDiffer,
  planReferenceCascade,
  relinkedFields,
  type VaultObjectCatalogue,
} from "./vaultObjectRefs";

const conn = (id: string, over: Partial<Connection> = {}): Connection =>
  ({ id, name: id, host: `${id}.example`, port: 22, username: "root", vault_id: "personal", tags: [], ...over }) as Connection;
const key = (id: string, over: Partial<SshKey> = {}): SshKey =>
  ({ id, name: id, key_type: "ed25519", tags: [], vault_id: "personal", ...over }) as SshKey;
const identity = (id: string, over: Partial<Identity> = {}): Identity =>
  ({ id, name: id, username: "u", tags: [], vault_id: "personal", ...over }) as Identity;
const snippet = (id: string, over: Partial<Snippet> = {}): Snippet =>
  ({ id, name: id, steps: [], tags: [], vault_id: "personal", ...over }) as Snippet;
const rule = (id: string, over: Partial<PortForwardingRule> = {}): PortForwardingRule =>
  ({ id, name: id, connection_ids: [], vault_id: "personal", ...over }) as PortForwardingRule;

const cat = (over: Partial<VaultObjectCatalogue> = {}): VaultObjectCatalogue => ({
  connections: [], identities: [], keys: [], snippets: [], rules: [], ...over,
});
const jump = (connection_id: string) => ({ id: `j-${connection_id}`, connection_id });

describe("planReferenceCascade", () => {
  it("carries a jump host, its key and the host's startup snippet", () => {
    const c = cat({
      connections: [conn("a", { jump_hosts: [jump("b")], pre_snippet_id: "s" }), conn("b", { key_id: "k" })],
      keys: [key("k")],
      snippets: [snippet("s")],
    });
    const plan = planReferenceCascade(c, [{ kind: "connection", id: "a" }], "team", "cut");
    expect(plan.map((t) => `${t.kind}:${t.id}:${t.action}`)).toEqual([
      "key:k:move", "connection:b:move", "snippet:s:move",
    ]);
  });

  it("orders dependencies before the objects that point at them", () => {
    const c = cat({
      connections: [conn("a", { jump_hosts: [jump("b")] }), conn("b", { jump_hosts: [jump("c")] }), conn("c")],
    });
    const plan = planReferenceCascade(c, [{ kind: "connection", id: "a" }], "team", "copy");
    expect(plan.map((t) => t.id)).toEqual(["c", "b"]);
  });

  it("copies a jump host another host left behind still uses", () => {
    const c = cat({
      connections: [conn("a", { jump_hosts: [jump("b")] }), conn("b"), conn("other", { jump_hosts: [jump("b")] })],
    });
    const plan = planReferenceCascade(c, [{ kind: "connection", id: "a" }], "team", "cut");
    expect(plan).toEqual([expect.objectContaining({ id: "b", action: "copy" })]);
  });

  it("copies what a copied object points at, since the original stays behind holding it", () => {
    const c = cat({
      connections: [conn("a", { jump_hosts: [jump("b")] }), conn("b", { key_id: "k" }), conn("other", { jump_hosts: [jump("b")] })],
      keys: [key("k")],
    });
    const plan = planReferenceCascade(c, [{ kind: "connection", id: "a" }], "team", "cut");
    expect(plan.map((t) => `${t.id}:${t.action}`)).toEqual(["k:copy", "b:copy"]);
  });

  it("moves an object only referenced from inside the destination", () => {
    const c = cat({
      connections: [conn("a", { key_id: "k" }), conn("there", { key_id: "k", vault_id: "team" })],
      keys: [key("k")],
    });
    const plan = planReferenceCascade(c, [{ kind: "connection", id: "a" }], "team", "cut");
    expect(plan).toEqual([expect.objectContaining({ id: "k", action: "move" })]);
  });

  it("leaves alone what is already in the destination, and what travels in the paste", () => {
    const c = cat({
      connections: [conn("a", { jump_hosts: [jump("b")], key_id: "k" }), conn("b")],
      keys: [key("k", { vault_id: "team" })],
    });
    const roots = [{ kind: "connection" as const, id: "a" }, { kind: "connection" as const, id: "b" }];
    expect(planReferenceCascade(c, roots, "team", "cut")).toEqual([]);
  });

  it("follows nested snippet calls and a rule's hosts", () => {
    const c = cat({
      rules: [rule("r", { connection_ids: ["h"] })],
      connections: [conn("h", { post_snippet_id: "outer" })],
      snippets: [snippet("outer", { steps: [{ kind: "snippet", snippet_id: "inner" }] }), snippet("inner")],
    });
    const plan = planReferenceCascade(c, [{ kind: "port_forward", id: "r" }], "team", "copy");
    expect(plan.map((t) => `${t.kind}:${t.id}`)).toEqual(["snippet:inner", "snippet:outer", "connection:h"]);
  });

  it("carries the identity of a jump whose host is gone, from its snapshot", () => {
    const c = cat({
      connections: [conn("a", { jump_hosts: [{ id: "j", connection_id: "gone", host: "x", port: 22, identity_id: "i" }] })],
      identities: [identity("i")],
    });
    const plan = planReferenceCascade(c, [{ kind: "connection", id: "a" }], "team", "copy");
    expect(plan).toEqual([expect.objectContaining({ kind: "identity", id: "i" })]);
  });

  it("terminates on a reference cycle", () => {
    const c = cat({
      connections: [conn("a", { jump_hosts: [jump("b")] }), conn("b", { jump_hosts: [jump("c")] }), conn("c", { jump_hosts: [jump("b")] })],
    });
    const plan = planReferenceCascade(c, [{ kind: "connection", id: "a" }], "team", "cut");
    expect(plan.map((t) => t.id).sort()).toEqual(["b", "c"]);
  });
});

describe("relinkedFields", () => {
  it("rewrites every reference a host holds through the remap", () => {
    const remap = new Map([
      ["key:k", "k2"], ["identity:i", "i2"], ["connection:b", "b2"], ["snippet:s", "s2"],
    ]);
    const c = conn("a", { key_id: "k", identity_id: "i", jump_hosts: [jump("b")], pre_snippet_id: "s", post_snippet_id: "keep" });
    expect(relinkedFields("connection", c, remap)).toMatchObject({
      key_id: "k2", identity_id: "i2", pre_snippet_id: "s2", post_snippet_id: "keep",
      jump_hosts: [expect.objectContaining({ connection_id: "b2" })],
    });
  });

  it("reports a change only when something was remapped", () => {
    const r = rule("r", { connection_ids: ["h"] });
    expect(linksDiffer("port_forward", r, new Map())).toBe(false);
    expect(linksDiffer("port_forward", r, new Map([["connection:h", "h2"]]))).toBe(true);
  });
});
