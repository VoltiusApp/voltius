// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { prng } from "@/test/prng";
import { fingerprint } from "./hostFields";
import type { SshConfigHost } from "./parse";
import { reconcile } from "./reconcile";
import { mergeSshConfigState, presentAt, type ManagedEntry, type SshConfigState } from "./state";

const DEVICES = ["d1", "d2", "d3"];
const ALIASES = ["web", "db", "api", "git", "ci"];
const ADDRESSES = ["10.0.0.1", "10.0.0.2"];
const SEEDS = 2000;
const STEPS = 100;

interface Conn { id: string; vault_id: string; created_at: string; host: string; port: number; username: string; connection_type: "ssh"; auth_type: "password"; jump_hosts: []; rev: number }
interface Store { state: SshConfigState; conns: Map<string, Conn>; tombs: Map<string, number> }
interface Device { id: string; config: Map<string, string>; readable: boolean; view: Store }

const emptyStore = (): Store => ({ state: {}, conns: new Map(), tombs: new Map() });

function mergeConns(a: Store, b: Store): Pick<Store, "conns" | "tombs"> {
  const tombs = new Map([...b.tombs, ...a.tombs].sort(([, x], [, y]) => y - x));
  const conns = new Map<string, Conn>();
  for (const c of [...a.conns.values(), ...b.conns.values()]) {
    const prev = conns.get(c.id);
    if (!tombs.has(c.id) && (!prev || c.rev > prev.rev)) conns.set(c.id, c);
  }
  return { conns, tombs };
}

function simulate(seed: number) {
  const random = prng(seed);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const trace: string[] = [];
  let now = 1_000;
  let rev = 0;
  let serial = 0;
  let cloud = emptyStore();
  const exempt = new Set<string>();
  const linked = new Set<string>();
  const devices: Device[] = DEVICES.map((id) => ({ id, config: new Map([[pick(ALIASES), pick(ADDRESSES)]]), readable: true, view: emptyStore() }));
  const hostsOf = (d: Device): SshConfigHost[] => (d.readable ? [...d.config].map(([alias, hostname]) => ({ alias, hostname, port: 22, user: "u" })) : []);
  const liveIn = (store: Store) => Object.entries(store.state.managed ?? {}).filter(([id, e]) => !e.gone && store.conns.has(id));
  const fail = (message: string) => { throw new Error(`seed ${seed}: ${message}\n${trace.join("\n")}`); };

  const syncState = (d: Device) => {
    const state = mergeSshConfigState(d.view.state, cloud.state, now);
    d.view = { ...d.view, state };
    cloud = { ...cloud, state };
  };
  const syncConns = (d: Device) => {
    const merged = mergeConns(d.view, cloud);
    d.view = { ...d.view, ...merged, conns: new Map(merged.conns), tombs: new Map(merged.tombs) };
    cloud = { ...cloud, ...merged, conns: new Map(merged.conns), tombs: new Map(merged.tombs) };
  };

  const run = (d: Device) => {
    const v = d.view;
    const hosts = hostsOf(d);
    const presentHere = Object.values(v.state.managed ?? {}).some((e) => !e.gone && e.devices[d.id]?.present);
    const deleteAllowed = d.readable && !(hosts.length === 0 && presentHere);
    const before = v.state.managed ?? {};
    const plan = reconcile({ hosts, all: hosts, connections: [...v.conns.values()], deleted: Object.fromEntries([...v.tombs].map(([id, at]) => [id, new Date(at).toISOString()])), state: v.state, device: d.id, now, deleteAllowed });
    const managed: Record<string, ManagedEntry> = { ...plan.managed };
    for (const host of plan.creates) {
      const c = newConn(host);
      v.conns.set(c.id, c);
      managed[c.id] = { alias: host.alias, at: now, devices: { [d.id]: presentAt(fingerprint(host), now) } };
    }
    for (const u of plan.updates) {
      const c = v.conns.get(u.id)!;
      v.conns.set(u.id, { ...c, host: u.host.hostname, port: u.host.port, username: u.host.user ?? c.username, rev: ++rev });
    }
    for (const id of plan.deletes) {
      v.conns.delete(id);
      v.tombs.set(id, now);
    }
    d.view = { ...v, state: mergeSshConfigState({ managed, seen: { [d.id]: now } }, v.state, now) };
    trace.push(`${now} run ${d.id} creates=${plan.creates.map((h) => h.alias)} updates=${plan.updates.map((u) => u.id)} deletes=${plan.deletes} held=${plan.held.map((h) => h.alias)}`);
    // A delete either drops a duplicate that leaves a survivor, or an alias this readable config no longer has
    // and that no other computer still holds, unless this computer held it too.
    for (const id of plan.deletes) {
      if (linked.has(id)) fail(`${d.id} deleted linked host ${id}`);
      const e = before[id]!;
      if (liveIn(d.view).some(([, x]) => x.alias === e.alias)) continue;
      if (!d.readable || d.config.has(e.alias)) fail(`${d.id} deleted ${id} (${e.alias}) and no host keeps the alias`);
      const heldHere = Object.values(before).some((x) => x.alias === e.alias && x.devices[d.id]?.present);
      if (!heldHere && Object.values(e.devices).some((p) => p.present)) fail(`${d.id} deleted ${id} (${e.alias}) that another computer still holds`);
    }
    return plan;
  };

  const newConn = (host: SshConfigHost): Conn => ({ id: `c${++serial}`, vault_id: "personal", created_at: String(serial).padStart(6, "0"), host: host.hostname, port: host.port, username: host.user ?? "", connection_type: "ssh", auth_type: "password", jump_hosts: [], rev: ++rev });

  for (let step = 0; step < STEPS; step++) {
    now += 1_000;
    const d = pick(devices);
    const roll = random();
    if (roll < 0.15) {
      const alias = pick(ALIASES);
      if (d.config.has(alias) && d.config.size > 1) d.config.delete(alias);
      else d.config.set(alias, pick(ADDRESSES));
      trace.push(`${now} edit ${d.id} ${JSON.stringify([...d.config])}`);
    } else if (roll < 0.22) {
      d.readable = !d.readable;
      trace.push(`${now} ${d.id} readable=${d.readable}`);
    } else if (roll < 0.5) {
      run(d);
    } else if (roll < 0.7) {
      syncState(d);
      syncConns(d);
      trace.push(`${now} sync ${d.id}`);
    } else if (roll < 0.9) {
      // One blob carries both files, but a pull may apply them in either order with a run in between.
      const [first, second] = random() < 0.5 ? [syncState, syncConns] : [syncConns, syncState];
      first(d);
      trace.push(`${now} ${d.id} pulls ${first === syncState ? "state" : "connections"} first`);
      run(d);
      second(d);
      first(d);
    } else if (roll < 0.95) {
      const [hit] = liveIn(d.view);
      if (hit) {
        d.view.conns.delete(hit[0]);
        d.view.tombs.set(hit[0], now);
        exempt.add(hit[1].alias);
        trace.push(`${now} ${d.id} deletes ${hit[0]} (${hit[1].alias}) by hand`);
      }
    } else if (roll < 0.965) {
      now += 31 * 24 * 3600 * 1000;
      trace.push(`${now} 31 days pass`);
    } else if (roll < 0.98) {
      const host = hostsOf(d).find((h) => !liveIn(d.view).some(([, e]) => e.alias === h.alias));
      if (host) {
        const c = newConn(host);
        d.view.conns.set(c.id, c);
        d.view.state = mergeSshConfigState({ managed: { [c.id]: { alias: host.alias, at: now, linked: true, devices: { [d.id]: presentAt("", now) } } } }, d.view.state, now);
        linked.add(c.id);
        exempt.add(host.alias);
        trace.push(`${now} ${d.id} links ${c.id} (${host.alias})`);
      }
    }
  }

  for (const d of devices) d.readable = true;
  for (let round = 0; round < 8; round++) {
    for (const d of devices) {
      now += 1_000;
      syncState(d);
      syncConns(d);
      run(d);
      syncState(d);
      syncConns(d);
    }
  }
  for (const d of devices) {
    syncState(d);
    syncConns(d);
  }

  for (const d of devices) {
    now += 1_000;
    const plan = run(d);
    if (plan.creates.length || plan.updates.length || plan.deletes.length || plan.held.length) fail(`${d.id} has not settled`);
  }
  const wanted = new Set(devices.flatMap((d) => [...d.config.keys()]));
  const live = liveIn(cloud);
  for (const alias of wanted) {
    const count = live.filter(([, e]) => e.alias === alias).length;
    if (exempt.has(alias) ? count > 1 : count !== 1) fail(`${alias} has ${count} live managed hosts`);
  }
  for (const [id, e] of live) {
    if (!wanted.has(e.alias)) fail(`${id} (${e.alias}) is managed but no config has it`);
    const addresses = devices.filter((d) => d.config.has(e.alias)).map((d) => d.config.get(e.alias));
    if (!addresses.includes(cloud.conns.get(id)!.host)) fail(`${id} (${e.alias}) points at ${cloud.conns.get(id)!.host}, configs say ${addresses}`);
  }
  for (const [id, e] of Object.entries(cloud.state.managed ?? {})) {
    if (!e.gone && !cloud.conns.has(id)) fail(`${id} (${e.alias}) is managed but its connection is gone`);
  }
}

describe("reconcile across computers", () => {
  it("deletes only duplicates or aliases gone from a readable config, never a linked host, and converges to one host per alias", () => {
    for (let seed = 1; seed <= SEEDS; seed++) expect(() => simulate(seed)).not.toThrow();
  }, 60_000);
});
