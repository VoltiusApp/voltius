import { describe, expect, it } from "vitest";
import type { Connection } from "@/types";
import { connectionFieldsOf, fingerprint, identityOf, identityPaths, jumpHops, keepOwned, keyExportsOf, ownedFieldsChanged, ownedFieldsOf, ownedFromHash, pickOwned, splitSupported } from "./hostFields";

const web = { alias: "web", hostname: "10.0.0.1", port: 22, user: "deploy", identityFile: "~/.ssh/id_web" };

describe("hostFields", () => {
  it("maps a host to connection fields", () => {
    expect(connectionFieldsOf(web)).toEqual({ name: "web", host: "10.0.0.1", port: 22, username: "deploy", auth_type: "key", connection_type: "ssh" });
    expect(connectionFieldsOf({ alias: "b", hostname: "b", port: 2222 })).toMatchObject({ username: "", auth_type: "password" });
  });

  it("fingerprints what the sync reads and nothing else", () => {
    expect(fingerprint(web)).toBe(fingerprint({ ...web, otherAliases: ["w"] }));
    expect(fingerprint(web)).not.toBe(fingerprint({ ...web, port: 2222 }));
    expect(identityOf(fingerprint(web))).toBe("~/.ssh/id_web");
    expect(identityOf(undefined)).toBeUndefined();
  });

  it("keeps owned fields over a write, and lets a vault move drop the owned key", () => {
    const conn = { id: "c", vault_id: "personal", host: "10.0.0.1", port: 22, username: "deploy", auth_type: "key", key_id: "k", tags: [] } as unknown as Connection;
    const owned = ownedFieldsOf(web);
    const write = { host: "evil", port: 22, username: "root", auth_type: "password", key_id: undefined, tags: [], jump_hosts: [], env_vars: [], agent_forwarding: false, legacy_algorithms: false, ask_vars_each_time: false } as never;
    expect(keepOwned(conn, write, owned)).toMatchObject({ host: "10.0.0.1", username: "deploy", auth_type: "key", key_id: "k" });
    expect(keepOwned(conn, { ...(write as object), vault_id: "lab" } as never, owned)).toMatchObject({ host: "10.0.0.1", username: "deploy", auth_type: "password", key_id: undefined });
    expect(keepOwned(conn, write, [])).toBe(write);
  });

  it("resolves ProxyJump hops against the config, in order", () => {
    const bastion = { alias: "bastion", hostname: "b.example", port: 2200, user: "ops" };
    expect(jumpHops("bastion,admin@[::1]:22", [bastion])).toEqual([
      { host: "b.example", port: 2200, username: "ops", ref: bastion },
      { host: "::1", port: 22, username: "admin" },
    ]);
  });

  it("turns a readable key into a key and an unreadable one into a reference", () => {
    const PUB = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHqW1p3nMuFvR5NHqhkxLQKfDVZ2VYFOxKvL8dW7dSpq";
    const files = { config: "", configError: null, includes: {}, keys: { "~/.ssh/id_web": { privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----", publicKey: null, privateReadable: true } } };
    const { keys, keyRefs } = keyExportsOf(["~/.ssh/id_web", "~/.ssh/gone"], files);
    expect(keys).toMatchObject([{ _eid: "k0", name: "id_web" }]);
    expect(keyRefs).toEqual([{ _eid: "k1", name: "gone", public_key: "" }]);
    expect(keyExportsOf(["~/.ssh/id_web"], files, false).keyRefs).toEqual([{ _eid: "k0", public_key: "" }]);
    const probed = { ...files, keys: { "~/.ssh/id_web": { privateKey: null, publicKey: PUB, privateReadable: true } } };
    expect(keyExportsOf(["~/.ssh/id_web"], probed, false).keyRefs).toEqual([{ _eid: "k0", name: "id_web", public_key: PUB }]);
  });

  it("lists each IdentityFile once and splits unsupported hosts from the rest", () => {
    const coder = { alias: "coder", hostname: "coder", port: 22, proxyCommand: true as const };
    expect(identityPaths([web, { ...web, alias: "w2" }, coder])).toEqual(["~/.ssh/id_web"]);
    expect(splitSupported({ hosts: [web, coder], skipped: [{ kind: "match", text: "Match all" }] })).toEqual({
      hosts: [web],
      skipped: [{ alias: "Match all", reason: "match", target: "" }, { alias: "coder", reason: "proxyCommand", target: "coder:22" }],
    });
  });

  it("owns only what the stanza sets", () => {
    expect(ownedFieldsOf({ alias: "a", hostname: "a", port: 22 })).toEqual(["connection_type", "host", "port"]);
    expect(ownedFieldsOf({ ...web, proxyJump: "b" })).toEqual(["connection_type", "host", "port", "username", "auth_type", "identity_id", "key_id", "jump_hosts"]);
    expect(pickOwned({ host: "h", key_id: "k", name: "n" }, ["host"])).toEqual({ host: "h" });
    expect(ownedFromHash(fingerprint({ ...web, proxyJump: "b" }))).toEqual(ownedFieldsOf({ ...web, proxyJump: "b" }));
    expect(ownedFromHash(undefined)).toEqual(["connection_type", "host", "port"]);
  });

  it("survives a malformed device hash", () => {
    expect(identityOf("not json")).toBeUndefined();
    expect(identityOf('{"a":1}')).toBeUndefined();
    expect(ownedFromHash("not json")).toEqual(["connection_type", "host", "port"]);
    expect(ownedFromHash('"str"')).toEqual(["connection_type", "host", "port"]);
  });

  it("round-trips a partial fingerprint", () => {
    expect(ownedFromHash(fingerprint({ alias: "u", hostname: "h", port: 22, user: "me" }))).toEqual(["connection_type", "host", "port", "username"]);
  });

  it("lists only the owned fields a patch would change", () => {
    const conn = { host: "a", port: 22, username: "u", auth_type: "key", connection_type: "ssh", key_id: "k", jump_hosts: [] } as unknown as Connection;
    expect(ownedFieldsChanged(conn, { name: "x", host: "a", port: 2222 }, ["host", "port"])).toEqual(["port"]);
    expect(ownedFieldsChanged(conn, { key_id: "other" }, ["host", "port"])).toEqual([]);
    expect(ownedFieldsChanged(conn, { tags: ["t"] }, ["host", "port", "key_id"])).toEqual([]);
    expect(ownedFieldsChanged(conn, { tags: ["t"], identity_id: null, key_id: "k" } as never, ["identity_id", "key_id"])).toEqual([]);
    expect(ownedFieldsChanged(conn, { key_id: null } as never, ["key_id"])).toEqual(["key_id"]);
  });
});
