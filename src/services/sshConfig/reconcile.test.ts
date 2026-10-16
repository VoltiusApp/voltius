// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useTeamStore } from "@/stores/teamStore";
import { fingerprint } from "./hostFields";
import { reconcile, type ReconcileInput } from "./reconcile";
import { REMOVED_TTL_MS } from "./state";

const h = (alias: string, hostname = `${alias}.example`) => ({ alias, hostname, port: 22 });
const conn = (id: string, created_at = "2026-01-01", vault_id = "personal", host = "web.example") => ({ id, vault_id, created_at, host, port: 22, username: "", auth_type: "password" as const, jump_hosts: [] });
const keyedConn = (id: string, key_id = "k1") => ({ ...conn(id), auth_type: "key" as const, key_id });
const run = (over: Partial<ReconcileInput>) => reconcile({ hosts: [], connections: [], deleted: {}, state: {}, device: "d1", now: 100, deleteAllowed: true, ...over, all: over.all ?? over.hosts ?? [] });
const live = (alias: string, devices = {}) => ({ alias, at: 1, devices });

describe("reconcile", () => {
  beforeEach(() => {
    useTeamStore.setState({ teams: [{ id: "team-abc", name: "T", owner_id: "o", owner_tier: "free", created_at: "2026-01-01", role_ids: [] }] });
  });

  it("creates unknown aliases", () => {
    expect(run({ hosts: [h("web")] }).creates.map((x) => x.alias)).toEqual(["web"]);
  });

  it("never recreates a detached alias, but recreates a removed one", () => {
    const state = { managed: { c1: { ...live("web"), gone: "detached" as const }, c2: { ...live("db"), gone: "removed" as const } } };
    expect(run({ hosts: [h("web"), h("db")], state }).creates.map((x) => x.alias)).toEqual(["db"]);
  });

  it("updates only when this device's fingerprint changed", () => {
    const state = { managed: { c1: live("web", { d1: { present: true, hash: fingerprint(h("web")), at: 1 } }) } };
    const same = run({ hosts: [h("web")], connections: [conn("c1")], state });
    expect(same.updates).toEqual([]);
    expect(same.managed).toEqual({});
    const moved = run({ hosts: [h("web", "10.0.0.9")], connections: [conn("c1")], state });
    expect(moved.updates).toEqual([{ id: "c1", host: h("web", "10.0.0.9"), was: fingerprint(h("web")), identityChanged: false, drifted: false }]);
    expect(moved.managed.c1.devices.d1).toEqual({ present: true, hash: fingerprint(h("web", "10.0.0.9")), at: 100 });
    expect(moved.managed.c1.at).toBe(1);
  });

  it("deletes a linked host whose alias left the file before its first run", () => {
    const state = { managed: { c1: live("web", { d1: { present: true, hash: "", at: 1 } }) } };
    const r = run({ hosts: [], all: [h("db")], connections: [conn("c1")], state, deleteAllowed: true });
    expect(r.deletes).toEqual(["c1"]);
  });

  it("re-resolves the key of a host whose key left its vault", () => {
    const keyed = { ...h("web"), identityFile: "~/.ssh/id" };
    const state = { managed: { c1: live("web", { d1: { present: true, hash: fingerprint(keyed), at: 1 } }) } };
    expect(run({ hosts: [keyed], connections: [keyedConn("c1")], state }).updates).toEqual([]);
    expect(run({ hosts: [keyed], connections: [keyedConn("c1")], state, rekey: new Set(["c1"]) }).updates).toMatchObject([{ id: "c1", identityChanged: true }]);
  });

  it("repairs an owned field changed outside the sync, unless a present device's stanza set it", () => {
    const devices = { d1: { present: true, hash: fingerprint(h("web")), at: 1 } };
    const edited = conn("c1", undefined, undefined, "10.9.9.9");
    expect(run({ hosts: [h("web")], connections: [edited], state: { managed: { c1: live("web", devices) } } }).updates).toMatchObject([{ id: "c1", drifted: true, identityChanged: false }]);
    const other = { ...devices, d2: { present: true, hash: fingerprint(h("web", "10.9.9.9")), at: 1 } };
    expect(run({ hosts: [h("web")], connections: [edited], state: { managed: { c1: live("web", other) } } }).updates).toEqual([]);
  });

  it("repairs the key, auth type and jump hosts a write outside the sync changed", () => {
    const keyed = { ...h("web"), identityFile: "~/.ssh/id" };
    const keyState = (key?: string) => ({ managed: { c1: live("web", { d1: { present: true, hash: fingerprint(keyed), at: 1, ...(key && { key }) } }) } });
    expect(run({ hosts: [keyed], connections: [keyedConn("c1", "k2")], state: keyState("k2") }).updates).toEqual([]);
    expect(run({ hosts: [keyed], connections: [keyedConn("c1", "k2")], state: keyState() }).updates).toEqual([]);
    expect(run({ hosts: [keyed], connections: [keyedConn("c1", "k2")], state: keyState("k1") }).updates).toMatchObject([{ id: "c1", drifted: true, identityChanged: true }]);
    expect(run({ hosts: [keyed], connections: [conn("c1")], state: keyState("k1") }).updates).toMatchObject([{ id: "c1", drifted: true, identityChanged: true }]);

    const jumped = { ...h("web"), proxyJump: "bastion" };
    const all = [jumped, h("bastion")];
    const managed = {
      c1: live("web", { d1: { present: true, hash: fingerprint(jumped), at: 1 } }),
      c2: live("bastion", { d1: { present: true, hash: fingerprint(h("bastion")), at: 1 } }),
    };
    const bastion = { ...conn("c2"), host: "bastion.example" };
    const viaBastion = { ...conn("c1"), jump_hosts: [{ id: "j", connection_id: "c2" }] };
    expect(run({ hosts: all, connections: [viaBastion, bastion], state: { managed } }).updates).toEqual([]);
    expect(run({ hosts: all, connections: [conn("c1"), bastion], state: { managed } }).updates).toMatchObject([{ id: "c1", drifted: true, identityChanged: false }]);
  });

  it("detaches instead of deleting a host the user had before linking it", () => {
    const state = { managed: { c1: { ...live("web", { d1: { present: true, hash: fingerprint(h("web")), at: 1 } }), linked: true } } };
    const r = run({ hosts: [], all: [h("db")], connections: [conn("c1")], state });
    expect(r.deletes).toEqual([]);
    expect(r.managed.c1).toMatchObject({ gone: "detached", at: 100 });
  });

  it("detaches a managed host whose stanza gained a ProxyCommand", () => {
    const state = { managed: { c1: live("web", { d1: { present: true, hash: fingerprint(h("web")), at: 1 } }) } };
    const r = run({ hosts: [], all: [{ ...h("web"), proxyCommand: true as const }], connections: [conn("c1")], state });
    expect(r.detachedProxied).toEqual(["c1"]);
    expect(r.updates).toEqual([]);
    expect(r.deletes).toEqual([]);
    expect(r.managed.c1).toMatchObject({ gone: "detached", at: 100 });
  });

  it("reports an alias held by a host that has not arrived yet", () => {
    const state = { managed: { c9: live("web", { d2: { present: true, hash: "x", at: 1 } }) } };
    const r = run({ hosts: [h("web")], state });
    expect(r.creates).toEqual([]);
    expect(r.held.map((x) => x.alias)).toEqual(["web"]);
  });

  it("treats a first sight by this device as a change", () => {
    const state = { managed: { c1: live("web", { d2: { present: true, hash: "x", at: 1 } }) } };
    const r = run({ hosts: [h("web")], connections: [conn("c1")], state });
    expect(r.updates[0]).toMatchObject({ id: "c1", identityChanged: true });
  });

  it("ignores the presence of a device not seen for 30 days", () => {
    const devices = { d1: { present: true, hash: "a", at: 1 }, old: { present: true, hash: "b", at: 1 } };
    const now = 40 * 24 * 3600 * 1000;
    const stale = run({ hosts: [], connections: [conn("c1")], state: { managed: { c1: live("web", devices) }, seen: { old: 1 } }, now });
    expect(stale.deletes).toEqual(["c1"]);
    const recent = run({ hosts: [], connections: [conn("c1")], state: { managed: { c1: live("web", devices) }, seen: { old: now - 1000 } }, now });
    expect(recent.deletes).toEqual([]);
  });

  it("deletes only when no device still has the alias", () => {
    const both = { managed: { c1: live("web", { d1: { present: true, hash: "a", at: 1 }, d2: { present: true, hash: "b", at: 1 } }) } };
    const r1 = run({ hosts: [], connections: [conn("c1")], state: both });
    expect(r1.deletes).toEqual([]);
    expect(r1.managed.c1.devices.d1.present).toBe(false);
    expect(r1.managed.c1.at).toBe(1);
    const mine = { managed: { c1: live("web", { d1: { present: true, hash: "a", at: 1 }, d2: { present: false, hash: "b", at: 1 } }) } };
    const r2 = run({ hosts: [], connections: [conn("c1")], state: mine });
    expect(r2.deletes).toEqual(["c1"]);
    expect(r2.managed.c1).toMatchObject({ gone: "removed", at: 100 });
  });

  it("finishes a delete when every computer dropped the alias before seeing the others", () => {
    const absent = { managed: { c1: live("web", { d1: { present: false, hash: "a", at: 1 }, d2: { present: false, hash: "b", at: 1 } }) } };
    const r = run({ hosts: [], all: [h("db")], connections: [conn("c1")], state: absent });
    expect(r.deletes).toEqual(["c1"]);
    expect(r.managed.c1).toMatchObject({ gone: "removed", at: 100 });
  });

  it("hands a dropped duplicate's computers to the survivor, so it is kept while they have the alias", () => {
    const state = { managed: { c1: live("web", { d1: { present: true, hash: "a", at: 1 } }), c2: live("web", { d2: { present: true, hash: "b", at: 1 } }) } };
    const r = run({ hosts: [], all: [h("db")], connections: [conn("c1", "2026-01-01"), conn("c2", "2026-02-01")], state });
    expect(r.deletes).toEqual(["c2"]);
    expect(r.managed.c1).toMatchObject({ devices: { d1: { present: false }, d2: { present: true } } });
    expect(r.managed.c1.gone).toBeUndefined();
  });

  it("treats a tombstone older than the removed-record TTL as the sync's own delete", () => {
    const state = { managed: { c1: live("web", { d2: { present: true, hash: "b", at: 1 } }) } };
    const later = REMOVED_TTL_MS + 1000;
    expect(run({ hosts: [h("web")], deleted: { c1: "1970-01-01T00:00:00Z" }, state, now: later }).managed.c1).toMatchObject({ gone: "removed", tombstoned: true });
  });

  it("marks a host it finds tombstoned as inferred", () => {
    const state = { managed: { c1: live("web", { d2: { present: true, hash: "b", at: 1 } }) } };
    expect(run({ hosts: [h("web")], deleted: { c1: "1970-01-01T00:00:00Z" }, state }).managed.c1).toMatchObject({ gone: "detached", tombstoned: true });
  });

  it("never touches another device's aliases", () => {
    const theirs = { managed: { c1: live("ci", { d2: { present: true, hash: "b", at: 1 } }) } };
    const r = run({ hosts: [h("web")], connections: [conn("c1")], state: theirs });
    expect(r.deletes).toEqual([]);
    expect(r.managed.c1).toBeUndefined();
  });

  it("deletes nothing when deletes are not allowed", () => {
    const mine = { managed: { c1: live("web", { d1: { present: true, hash: "a", at: 1 } }) } };
    const r = run({ hosts: [], connections: [conn("c1")], state: mine, deleteAllowed: false });
    expect(r.deletes).toEqual([]);
    expect(r.managed).toEqual({});
  });

  it("detaches an entry whose host was deleted by hand while a device still has it", () => {
    const state = { managed: { c1: live("web", { d2: { present: true, hash: "b", at: 1 } }) } };
    const r = run({ hosts: [h("web")], connections: [], deleted: { c1: "1970-01-01T00:00:00Z" }, state });
    expect(r.managed.c1).toMatchObject({ gone: "detached", at: 100 });
    expect(r.creates).toEqual([]);
  });

  it("detaches a host moved to a team vault", () => {
    const state = { managed: { c1: live("web", { d1: { present: true, hash: "a", at: 1 } }) } };
    const r = run({ hosts: [h("web")], connections: [conn("c1", "2026-01-01", "team-abc")], state });
    expect(r.detachedToTeam).toEqual(["c1"]);
    expect(r.managed.c1.gone).toBe("detached");
  });

  it("never deletes a linked host for a duplicate alias: it keeps it, or detaches it", () => {
    const state = { managed: { c1: { ...live("web"), linked: true }, c2: live("web") } };
    const r = run({ hosts: [h("web")], connections: [conn("c1", "2026-02-01"), conn("c2", "2026-01-01")], state });
    expect(r.deletes).toEqual(["c2"]);
    expect(r.updates.map((u) => u.id)).toEqual(["c1"]);
    const both = { managed: { c1: { ...live("web"), linked: true }, c2: { ...live("web"), linked: true } } };
    const kept = run({ hosts: [h("web")], connections: [conn("c1", "2026-02-01"), conn("c2", "2026-01-01")], state: both });
    expect(kept.deletes).toEqual([]);
    expect(kept.managed.c1.gone).toBe("detached");
  });

  it("detaches a host excluded from sync once another computer syncs, releasing the alias there", () => {
    const state = { managed: { c1: live("web", { d1: { present: true, hash: "a", at: 1 } }) }, seen: { d1: 90 } };
    expect(run({ hosts: [h("web")], connections: [conn("c1")], state, unsynced: new Set(["c1"]) }).detachedUnsynced).toEqual([]);
    const shared = { ...state, seen: { d1: 90, d2: 90 } };
    const r = run({ hosts: [h("web")], connections: [conn("c1")], state: shared, unsynced: new Set(["c1"]) });
    expect(r.detachedUnsynced).toEqual(["c1"]);
    expect(r.managed.c1.gone).toBe("detached");
    expect(r.creates).toEqual([]);
    expect(run({ hosts: [h("web")], state: { ...shared, managed: r.managed }, device: "d2" }).held).toEqual([]);
  });

  it("keeps the older of two live entries for one alias", () => {
    const state = { managed: { c1: live("web"), c2: live("web") } };
    const r = run({ hosts: [h("web")], connections: [conn("c1", "2026-02-01"), conn("c2", "2026-01-01")], state });
    expect(r.deletes).toEqual(["c1"]);
    expect(r.managed.c1.gone).toBe("removed");
    expect(r.updates.map((u) => u.id)).toEqual(["c2"]);
  });

  it("a renamed alias replaces its host", () => {
    const state = { managed: { c1: live("web", { d1: { present: true, hash: fingerprint(h("web")), at: 1 } }) } };
    const r = run({ hosts: [h("www", "web.example")], connections: [conn("c1")], state });
    expect(r.creates.map((x) => x.alias)).toEqual(["www"]);
    expect(r.deletes).toEqual(["c1"]);
  });

  it("never deletes or re-marks a detached entry that this device had", () => {
    const state = { managed: { c1: { ...live("web", { d1: { present: true, hash: "a", at: 1 } }), gone: "detached" as const } } };
    const r = run({ hosts: [], connections: [conn("c1")], state });
    expect(r.deletes).toEqual([]);
    expect(r.managed).toEqual({});
  });

  it("flags identityChanged only when the recorded IdentityFile moves", () => {
    const at = (identityFile: string) => ({ ...h("web"), identityFile });
    const state = { managed: { c1: live("web", { d1: { present: true, hash: fingerprint(at("~/.ssh/a")), at: 1 } }) } };
    const moved = run({ hosts: [at("~/.ssh/b")], connections: [keyedConn("c1")], state });
    expect(moved.updates[0].identityChanged).toBe(true);
    const sameKey = run({ hosts: [{ ...at("~/.ssh/a"), hostname: "other.example" }], connections: [keyedConn("c1")], state });
    expect(sameKey.updates[0].identityChanged).toBe(false);
  });

  it("removes a live entry whose connection vanished with no device present, and recreates the alias", () => {
    const state = { managed: { c1: live("web", { d1: { present: false, hash: "a", at: 1 } }) } };
    const r = run({ hosts: [h("web")], connections: [], deleted: { c1: "1970-01-01T00:00:00Z" }, state });
    expect(r.managed.c1).toMatchObject({ gone: "removed", at: 100 });
    expect(r.creates.map((x) => x.alias)).toEqual(["web"]);
  });

  it("leaves a managed alias alone when it is still in the file but unsupported", () => {
    const state = { managed: { c1: live("web", { d1: { present: true, hash: "a", at: 1 } }) } };
    const r = run({ hosts: [], all: [h("web")], connections: [conn("c1")], state });
    expect(r.deletes).toEqual([]);
    expect(r.updates).toEqual([]);
    expect(r.managed).toEqual({});
  });

  it("breaks created_at ties by the smaller connection id", () => {
    const state = { managed: { c2: live("web"), c1: live("web") } };
    const r = run({ hosts: [h("web")], connections: [conn("c2"), conn("c1")], state });
    expect(r.deletes).toEqual(["c2"]);
  });

  it("only the newest entry for an alias can block its creation", () => {
    const state = { managed: { c1: { ...live("web"), gone: "detached" as const }, c9: { ...live("web"), at: 5, gone: "removed" as const } } };
    expect(run({ hosts: [h("web")], state }).creates.map((x) => x.alias)).toEqual(["web"]);
  });

  it("leaves an entry alone when this device has never seen its connection", () => {
    const state = { managed: { c1: live("web", { d1: { present: true, hash: "old", at: 1 } }), c2: live("db", { d1: { present: true, hash: "a", at: 1 } }) } };
    const r = run({ hosts: [h("web", "10.0.0.9")], connections: [], deleted: { other: "1970-01-01T00:00:00Z" }, state });
    expect(r.creates).toEqual([]);
    expect(r.updates).toEqual([]);
    expect(r.deletes).toEqual([]);
    expect(r.managed).toEqual({});
  });

  it("updates the known live entry of an alias that also has an unseen one", () => {
    const state = { managed: { c1: live("web"), c2: live("web") } };
    const r = run({ hosts: [h("web")], connections: [conn("c2")], state });
    expect(r.updates.map((u) => u.id)).toEqual(["c2"]);
    expect(r.deletes).toEqual([]);
    expect(r.managed.c1).toBeUndefined();
  });
});
