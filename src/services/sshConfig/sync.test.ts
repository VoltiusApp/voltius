// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { invoke } from "@/lib/invoke";
import { log } from "@/lib/logger";
import * as connApi from "@/services/connections";
import { isSyncHalted } from "@/services/sync";
import { importIntoVault } from "@/services/import-export/storeAccess";
import type { ExportBundle } from "@/services/import-export/formats";
import type { OpensshFiles } from "@/services/import-export/parsers/openssh";
import { useNotificationStore } from "@/stores/notificationStore";
import { useSshConfigStore } from "@/stores/sshConfigStore";
import type { Connection } from "@/types";
import { getPlatform } from "@/utils/platform";
import { connectionFromForm } from "@/stores/connectionStore";
import { prng } from "@/test/prng";
import { fingerprint, identityOf } from "./hostFields";
import type { SshConfigHost } from "./parse";
import { reconcile } from "./reconcile";
import { mergeSshConfigState, type ManagedEntry, type SshConfigState } from "./state";
import { createSshConfigSync, sshConfigSync, sshConfigSyncNow, startSshConfigSyncEngine, type SyncDeps } from "./sync";

vi.mock("@/lib/invoke", () => ({ invoke: vi.fn() }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn(), getDeviceId: vi.fn(async () => "d1"), isSyncHalted: vi.fn(() => false) }));
vi.mock("@/utils/platform", () => ({ isMobilePlatform: (p: string | null) => p === "android" || p === "ios", getPlatform: vi.fn(async () => "linux") }));
vi.mock("@/services/account", () => ({ isServerMode: async () => false }));
vi.mock("@/stores/vaultStore", () => ({ useVaultStore: { getState: () => ({ vaults: [{ id: "personal", name: "Personal" }] }) } }));
vi.mock("@/stores/connectionStore", async (orig) => ({
  ...(await orig<object>()),
  useConnectionStore: { getState: () => ({ connections: conns, teamConnections: {}, loadConnections: async () => {} }) },
}));
vi.mock("@/services/connections", async () => {
  const { connectionFromForm } = await vi.importActual<typeof import("@/stores/connectionStore")>("@/stores/connectionStore");
  const now = "2026-10-15T00:00:00Z";
  return {
    listConnections: vi.fn(async () => structuredClone(conns)),
    listDeletedConnections: vi.fn(async () => Object.fromEntries(deletedIds.map((id) => [id, new Date(NOW).toISOString()]))),
    saveConnection: vi.fn(async (data) => {
      const c = connectionFromForm(data, { id: crypto.randomUUID(), now });
      conns.push(c);
      return c;
    }),
    updateConnection: vi.fn(async (id: string, data) => {
      const i = conns.findIndex((c) => c.id === id);
      conns[i] = connectionFromForm(data, { id, now, prev: conns[i] });
      return conns[i];
    }),
    deleteConnection: vi.fn(async (id: string) => {
      conns = conns.filter((c) => c.id !== id);
      deletedIds.push(id);
    }),
  };
});
vi.mock("@/services/keys", () => ({ listKeys: vi.fn(async () => [...keyVaults].map(([id, vault_id]) => ({ id, vault_id }))) }));
vi.mock("@/services/import-export/storeAccess", () => ({
  reloadKeys: vi.fn(),
  importIntoVault: vi.fn(async (bundle: ExportBundle, vault: string) => {
    const found = [...bundle.keys, ...(bundle.keyRefs ?? []).filter((r) => r.name === "id_web")];
    for (const k of found) keyVaults.set(`key-${k.name}`, vault);
    return { imported: 0, errors: [], connectionIds: new Map(), keyIds: new Map(found.map((k) => [k._eid!, `key-${k.name}`])) };
  }),
}));

const NOW = Date.now();
const JOINED = { d1: Number.MAX_SAFE_INTEGER };
const PRIVATE = "-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----";
const PUBLIC = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHqW1p3nMuFvR5NHqhkxLQKfDVZ2VYFOxKvL8dW7dSpq";
const PUBLIC_B = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGrSaGvq7gF8+ggYkHAkB5T/9DsWjY2QeMdohYMJr1bO";

let conns: Connection[];
let deletedIds: string[];
let keyVaults: Map<string, string>;
let disk: string | null;
let files: OpensshFiles;
const reads = vi.fn(async (_keyPaths?: string[], _mode?: string) => structuredClone(files));
const make = (over: Partial<SyncDeps> = {}) => createSshConfigSync({ read: reads, sleep: async () => {}, now: () => NOW, device: async () => "d1", ...over });
const gate = () => {
  const waiting: (() => void)[] = [];
  return { waiting, sleep: () => new Promise<void>((r) => { waiting.push(r); }), open: () => waiting.splice(0).forEach((r) => r()) };
};
const TWO_HOSTS = "Host web\n  HostName 10.0.0.1\nHost db\n  HostName 10.0.0.2\n";
const failSaveAfter = (ok: number) => {
  vi.spyOn(log, "error").mockImplementation(() => {});
  const save = vi.mocked(connApi.saveConnection);
  for (let i = 0; i < ok; i++) save.mockImplementationOnce(save.getMockImplementation()!);
  save.mockImplementationOnce(async () => { throw new Error("disk full"); });
};
const failStateSaves = () => {
  vi.spyOn(log, "error").mockImplementation(() => {});
  const real = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "ssh_config_state_save") throw new Error("disk full");
    return real(cmd, args as never);
  });
  return () => vi.mocked(invoke).mockImplementation(real);
};
const fresh = (over: Partial<OpensshFiles> = {}): OpensshFiles => ({ config: "Host web\n  HostName 10.0.0.1\n  User deploy\n", configError: null, includes: {}, keys: {}, ...over });

beforeEach(() => {
  conns = [];
  deletedIds = [];
  keyVaults = new Map();
  reads.mockClear();
  vi.mocked(importIntoVault).mockClear();
  vi.mocked(connApi.saveConnection).mockClear();
  vi.mocked(connApi.updateConnection).mockClear();
  files = fresh();
  disk = JSON.stringify({ joined: JOINED, sync: { on: true, vault: "personal", at: 1 } });
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "ssh_config_state_load") return disk;
    if (cmd === "ssh_config_state_save") disk = (args as { state: string }).state;
  });
});

afterEach(() => vi.restoreAllMocks());

describe("ssh-config sync runner", () => {
  it("creates managed hosts in the chosen vault and records them", async () => {
    const s = await make().request("manual");
    expect(s).toMatchObject({ created: 1, managed: 1 });
    expect(conns[0]).toMatchObject({ name: "web", host: "10.0.0.1", username: "deploy", vault_id: "personal" });
    expect(JSON.parse(disk!).managed[conns[0].id]).toMatchObject({ alias: "web", devices: { d1: { present: true } } });
  });

  it("does nothing when the setting is off", async () => {
    disk = null;
    expect(await make().request("manual")).toBeNull();
    expect(conns).toEqual([]);
  });

  it("acts only on two identical reads", async () => {
    const sync = make();
    for (let n = 0; n < 6; n++) reads.mockImplementationOnce(async () => ({ ...files, config: `Host h${n}\n  HostName 10.0.0.9\n` }));
    expect(await sync.request("manual")).toBeNull();
    expect(conns).toEqual([]);
    expect(reads).toHaveBeenCalledTimes(6);
  });

  it("retries a forced run until two reads agree", async () => {
    const sync = make();
    reads.mockImplementationOnce(async () => ({ ...files, config: "" })).mockImplementationOnce(async () => structuredClone(files));
    expect(await sync.request("manual")).toMatchObject({ created: 1 });
  });

  it("keeps the user's name and folder when the file changes", async () => {
    const sync = make();
    await sync.request("manual");
    conns[0] = { ...conns[0], name: "Prod Web", folder_id: "f1" };
    files.config = "Host web\n  HostName 10.0.0.2\n  User deploy\n";
    await sync.request("manual");
    expect(conns[0]).toMatchObject({ name: "Prod Web", folder_id: "f1", host: "10.0.0.2" });
  });

  it("leaves credentials, user and jump hosts alone when the stanza does not set them", async () => {
    files.config = "Host web\n  HostName 10.0.0.1\n";
    const sync = make();
    await sync.request("manual");
    conns[0] = { ...conns[0], username: "me", auth_type: "key", key_id: "k-mine", jump_hosts: [{ id: "j", connection_id: "b" }] };
    files.config = "Host web\n  HostName 10.0.0.2\n";
    await sync.request("manual");
    expect(conns[0]).toMatchObject({ host: "10.0.0.2", username: "me", auth_type: "key", key_id: "k-mine", jump_hosts: [{ id: "j", connection_id: "b" }] });
  });

  it("deletes a host whose alias left the file once no device has it", async () => {
    files.config += "Host db\n  HostName 10.0.0.2\n";
    const sync = make();
    await sync.request("manual");
    const db = conns.find((c) => c.name === "db")!;
    files = fresh();
    expect(await sync.request("manual")).toMatchObject({ removed: 1, managed: 1 });
    expect(conns.map((c) => c.name)).toEqual(["web"]);
    expect(JSON.parse(disk!).managed[db.id]).toMatchObject({ gone: "removed" });
  });

  it("keeps a host another device still has", async () => {
    const sync = make();
    await sync.request("manual");
    const state = JSON.parse(disk!);
    state.managed[conns[0].id].devices.d2 = { present: true, hash: "x", at: 1 };
    disk = JSON.stringify(state);
    files = fresh({ config: "Host db\n  HostName 10.0.0.2\n" });
    await sync.request("manual");
    expect(conns.map((c) => c.name)).toEqual(["web", "db"]);
    expect(JSON.parse(disk!).managed[conns[0].id].devices.d1.present).toBe(false);
  });

  it.each([
    ["an unreadable config", { config: null, configError: "cannot read" }],
    ["an unreadable Include", { config: "Include conf.d/*\nHost db\n  HostName 10.0.0.3\n", includes: { "conf.d/*": [{ path: "/h/.ssh/conf.d/x", text: null }] } }],
    ["an empty read", { config: "" }],
  ])("deletes nothing on %s", async (_, broken) => {
    const sync = make();
    await sync.request("manual");
    files = fresh(broken);
    await sync.request("manual");
    expect(conns.map((c) => c.name)).toContain("web");
  });

  it("still deletes when an Include outside ~/.ssh was refused", async () => {
    files.config += "Host db\n  HostName 10.0.0.2\n";
    const sync = make();
    await sync.request("manual");
    files = fresh({ config: "Include ~/.orbstack/ssh/config\nHost web\n  HostName 10.0.0.1\n  User deploy\n", includes: { "~/.orbstack/ssh/config": [{ path: "/h/.orbstack/ssh/config", text: null, refused: true }] } });
    const s = await sync.request("manual");
    expect(conns.map((c) => c.name)).toEqual(["web"]);
    expect(s!.skipped).toContainEqual({ alias: "Include /h/.orbstack/ssh/config", reason: "includeOutside", target: "" });
  });

  it("serialises overlapping triggers with one trailing run", async () => {
    const held = gate();
    const sync = make({ sleep: held.sleep });
    const first = sync.request("manual");
    await vi.waitFor(() => expect(held.waiting).toHaveLength(1));
    const second = sync.request("manual");
    expect(sync.request("manual")).toBe(second);
    await new Promise((r) => setTimeout(r, 10));
    expect(reads).toHaveBeenCalledTimes(1);
    held.open();
    await first;
    await vi.waitFor(() => expect(held.waiting).toHaveLength(1));
    held.open();
    await second;
    expect(reads).toHaveBeenCalledTimes(4);
    expect(conns).toHaveLength(1);
  });

  it("records the hosts a failed run created, so the next run does not duplicate them", async () => {
    files.config = TWO_HOSTS;
    failSaveAfter(1);
    const sync = make();
    expect(await sync.request("manual")).toBeNull();
    await sync.request("manual");
    expect(conns.map((c) => c.name).sort()).toEqual(["db", "web"]);
  });

  it("retries a failed run on the next poll and withdraws the banner", async () => {
    const failedBanner = () => useNotificationStore.getState().banners.some((b) => b.message === i18n.t("notifications.sshConfigSync.failed"));
    files.config = TWO_HOSTS;
    failSaveAfter(1);
    const sync = make();
    try {
      sync.start();
      await vi.waitFor(() => expect(failedBanner()).toBe(true));
      await sync.request("poll");
      expect(conns.map((c) => c.name).sort()).toEqual(["db", "web"]);
      expect(failedBanner()).toBe(false);
    } finally {
      sync.stop();
    }
  });

  it("retries a failed forced run on the next poll when the file did not change", async () => {
    const sync = make();
    try {
      sync.start();
      await vi.waitFor(() => expect(conns).toHaveLength(1));
      conns = [];
      disk = JSON.stringify({ joined: JOINED, sync: { on: true, vault: "personal", at: 1 } });
      failSaveAfter(0);
      expect(await sync.request("manual")).toBeNull();
      await sync.request("poll");
      expect(conns.map((c) => c.name)).toEqual(["web"]);
    } finally {
      sync.stop();
    }
  });

  it("keeps a dismissed vault-gone banner dismissed on later polls", async () => {
    const gone = () => useNotificationStore.getState().banners.filter((b) => b.message === i18n.t("notifications.sshConfigSync.vaultGone"));
    disk = JSON.stringify({ joined: JOINED, sync: { on: true, vault: "deleted-vault", at: 1 } });
    const sync = make();
    try {
      sync.start();
      await vi.waitFor(() => expect(gone()).toHaveLength(1));
      useNotificationStore.getState().dismissBanner(gone()[0].id);
      await sync.request("poll");
      await sync.request("poll");
      expect(gone()).toHaveLength(0);
    } finally {
      sync.stop();
    }
  });

  it("reads nothing on a computer that has not reviewed the switch, and offers the review", async () => {
    const review = () => useNotificationStore.getState().banners.find((b) => b.message === i18n.t("notifications.sshConfigSync.reviewHere"));
    disk = JSON.stringify({ joined: { d2: 5 }, sync: { on: true, vault: "personal", copyKeys: true, at: 5 } });
    expect(await make().request("manual")).toBeNull();
    expect(reads).not.toHaveBeenCalled();
    expect(conns).toEqual([]);
    expect(useSshConfigStore.getState().status.error).toBe("join");
    expect(review()?.actions).toHaveLength(1);
    disk = JSON.stringify({ ...JSON.parse(disk!), joined: { d1: 4 } });
    expect(await make().request("manual")).toBeNull();
    disk = JSON.stringify({ ...JSON.parse(disk!), joined: { d1: 6 } });
    expect(await make().request("manual")).toMatchObject({ created: 1 });
    expect(review()).toBeUndefined();
  });

  it("resumes on the next poll once the vault is usable again", async () => {
    const sync = make();
    try {
      sync.start();
      await vi.waitFor(() => expect(conns).toHaveLength(1));
      disk = JSON.stringify({ ...JSON.parse(disk!), sync: { on: true, vault: "deleted-vault", at: 2 } });
      await sync.request("poll");
      expect(useSshConfigStore.getState().status.error).toBe("vault");
      disk = JSON.stringify({ ...JSON.parse(disk!), sync: { on: true, vault: "personal", at: 3 } });
      expect(await sync.request("poll")).not.toBeNull();
      expect(useSshConfigStore.getState().status.error).toBeUndefined();
    } finally {
      sync.stop();
    }
  });

  it("creates nothing when the engine stops after the read", async () => {
    const held = gate();
    const sync = make({ device: async () => { await held.sleep(); return "d1"; } });
    sync.start();
    await vi.waitFor(() => expect(held.waiting).toHaveLength(1));
    sync.stop();
    held.open();
    expect(await sync.request("poll")).toBeNull();
    expect(conns).toEqual([]);
  });

  it("creates nothing when the switch goes off during a run", async () => {
    const held = gate();
    const sync = make({ sleep: held.sleep });
    const run = sync.request("manual");
    await vi.waitFor(() => expect(held.waiting).toHaveLength(1));
    disk = JSON.stringify({ joined: JOINED, sync: { on: false, vault: "personal", at: 2 } });
    held.open();
    expect(await run).toBeNull();
    expect(conns).toEqual([]);
  });

  it("detaches what a forced run created after the switch went off", async () => {
    const save = vi.mocked(connApi.saveConnection);
    const original = save.getMockImplementation()!;
    save.mockImplementationOnce(async (data) => {
      disk = JSON.stringify({ joined: JOINED, sync: { on: false, vault: "personal", at: 2 } });
      return original(data);
    });
    await make().request("manual");
    expect(JSON.parse(disk!).managed[conns[0].id]).toMatchObject({ alias: "web", gone: "detached" });
  });

  it("writes the state once per run", async () => {
    files.config = Array.from({ length: 200 }, (_, i) => `Host h${i}\n  HostName 10.0.${i >> 8}.${i & 255}\n`).join("");
    const saves = () => vi.mocked(invoke).mock.calls.filter(([c]) => c === "ssh_config_state_save").length;
    const before = saves();
    await make().request("manual");
    expect(saves() - before).toBe(1);
  });

  it("reads keys only for hosts whose IdentityFile is new or changed", async () => {
    files.config = "Host web\n  HostName 10.0.0.1\n  IdentityFile ~/.ssh/id_web\n";
    const sync = make();
    await sync.request("manual");
    expect(reads.mock.calls.some(([k]) => k?.includes("~/.ssh/id_web"))).toBe(true);
    expect(conns[0]).toMatchObject({ auth_type: "key", key_id: "key-id_web" });
    reads.mockClear();
    files.config = "Host web\n  HostName 10.0.0.9\n  IdentityFile ~/.ssh/id_web\n";
    await sync.request("manual");
    expect(reads.mock.calls.every(([k]) => !k)).toBe(true);
    expect(conns[0]).toMatchObject({ host: "10.0.0.9", auth_type: "key", key_id: "key-id_web" });
  });

  it("stores no private key when copyKeys is off, and links an existing vault key", async () => {
    disk = JSON.stringify({ joined: JOINED, sync: { on: true, vault: "personal", copyKeys: false, at: 1 } });
    files.config = "Host web\n  HostName 10.0.0.1\n  IdentityFile ~/.ssh/id_web\nHost db\n  HostName 10.0.0.2\n  IdentityFile ~/.ssh/id_new\n";
    files.keys = { "~/.ssh/id_web": { privateKey: null, publicKey: PUBLIC, privateReadable: true }, "~/.ssh/id_new": { privateKey: null, publicKey: PUBLIC_B, privateReadable: true } };
    const s = await make().request("manual");
    const bundle = vi.mocked(importIntoVault).mock.calls[0][0];
    expect(bundle.keys).toEqual([]);
    expect(bundle.keyRefs!.map((k) => [k.name, k.public_key])).toEqual([["id_web", PUBLIC], ["id_new", PUBLIC_B]]);
    expect(s!.skipped).toContainEqual({ alias: "db", reason: "keyNotCopied", target: "~/.ssh/id_new" });
    expect(conns.find((c) => c.name === "web")).toMatchObject({ auth_type: "key", key_id: "key-id_web" });
    expect(conns.find((c) => c.name === "db")).toMatchObject({ auth_type: "password", key_id: undefined });
    expect(reads).toHaveBeenCalledWith(["~/.ssh/id_web", "~/.ssh/id_new"], "probe");
    expect(reads.mock.calls.every(([, mode]) => mode === "probe")).toBe(true);
  });

  it("does not guess a vault key by name for a local key whose public half is unknown", async () => {
    disk = JSON.stringify({ joined: JOINED, sync: { on: true, vault: "personal", copyKeys: false, at: 1 } });
    files.config = "Host web\n  HostName 10.0.0.1\n  IdentityFile ~/.ssh/id_web\n";
    files.keys = { "~/.ssh/id_web": { privateKey: null, publicKey: null, privateReadable: true } };
    const s = await make().request("manual");
    expect(vi.mocked(importIntoVault).mock.calls[0][0].keyRefs).toEqual([{ _eid: "k0", public_key: "" }]);
    expect(s!.skipped).toContainEqual({ alias: "web", reason: "keyNotCopied", target: "~/.ssh/id_web" });
  });

  it("resolves an updated host's key in the host's own vault", async () => {
    files.config = "Host web\n  HostName 10.0.0.1\n  IdentityFile ~/.ssh/id_web\n";
    const sync = make();
    await sync.request("manual");
    conns[0] = { ...conns[0], vault_id: "lab" };
    files.config = "Host web\n  HostName 10.0.0.1\n  IdentityFile ~/.ssh/id_lab\n";
    files.keys = { "~/.ssh/id_lab": { privateKey: PRIVATE, publicKey: null, privateReadable: true } };
    await sync.request("manual");
    expect(vi.mocked(importIntoVault).mock.lastCall![1]).toBe("lab");
    expect(conns[0]).toMatchObject({ vault_id: "lab", key_id: "key-id_lab" });
  });

  it("resolves the key again when its host moves to another vault", async () => {
    files.config = "Host web\n  HostName 10.0.0.1\n  IdentityFile ~/.ssh/id_web\n";
    files.keys = { "~/.ssh/id_web": { privateKey: PRIVATE, publicKey: null, privateReadable: true } };
    const sync = make();
    await sync.request("manual");
    conns[0] = { ...conns[0], vault_id: "lab", key_id: undefined };
    await sync.request("manual");
    expect(vi.mocked(importIntoVault).mock.lastCall![1]).toBe("lab");
    expect(conns[0]).toMatchObject({ vault_id: "lab", key_id: "key-id_web", auth_type: "key" });
    vi.mocked(importIntoVault).mockClear();
    await sync.request("manual");
    expect(importIntoVault).not.toHaveBeenCalled();
  });

  it("keeps a working key when the new one cannot be resolved, and retries it", async () => {
    files.config = "Host web\n  HostName 10.0.0.1\n  IdentityFile ~/.ssh/id_web\n";
    const sync = make();
    await sync.request("manual");
    const id = conns[0].id;
    const mine = () => JSON.parse(disk!).managed[id].devices.d1;
    files.config = "Host web\n  HostName 10.0.0.2\n  IdentityFile ~/.ssh/id_new\n";
    const s = await sync.request("manual");
    expect(conns[0]).toMatchObject({ host: "10.0.0.2", auth_type: "key", key_id: "key-id_web" });
    expect(s!.skipped).toContainEqual({ alias: "web", reason: "key", target: "~/.ssh/id_new" });
    expect(mine()).toMatchObject({ present: true, hash: fingerprint({ alias: "web", hostname: "10.0.0.2", port: 22 }) });
    files.keys = { "~/.ssh/id_new": { privateKey: PRIVATE, publicKey: null, privateReadable: true } };
    await sync.request("manual");
    expect(conns[0]).toMatchObject({ key_id: "key-id_new" });
    expect(identityOf(mine().hash)).toBe("~/.ssh/id_new");
  });

  it("counts a device whose key never resolved as present, and retries the key", async () => {
    disk = JSON.stringify({ joined: JOINED, sync: { on: true, vault: "personal", copyKeys: false, at: 1 } });
    files.config = "Host db\n  HostName 10.0.0.2\n  IdentityFile ~/.ssh/id_new\n";
    const sync = make();
    await sync.request("manual");
    const id = conns[0].id;
    expect(JSON.parse(disk!).managed[id].devices.d1).toMatchObject({ present: true, hash: fingerprint({ alias: "db", hostname: "10.0.0.2", port: 22 }) });
    reads.mockClear();
    await sync.request("manual");
    expect(reads.mock.calls.some(([k]) => k?.includes("~/.ssh/id_new"))).toBe(true);
  });

  it("does not rewrite or re-record a host whose key still cannot be resolved", async () => {
    files.config = "Host db\n  HostName 10.0.0.2\n  IdentityFile ~/.ssh/id_new\n";
    const sync = make();
    await sync.request("manual");
    const saves = () => vi.mocked(invoke).mock.calls.filter(([c]) => c === "ssh_config_state_save").length;
    const before = saves();
    vi.mocked(connApi.updateConnection).mockClear();
    const s = await sync.request("manual");
    expect(s).toMatchObject({ updated: 0 });
    expect(s!.skipped).toContainEqual({ alias: "db", reason: "key", target: "~/.ssh/id_new" });
    expect(connApi.updateConnection).not.toHaveBeenCalled();
    expect(saves()).toBe(before);
  });

  it("picks up a key file that appears, on the next poll", async () => {
    files.config = "Host db\n  HostName 10.0.0.2\n  IdentityFile ~/.ssh/id_new\n";
    const sync = make();
    await sync.request("manual");
    expect(conns[0]).toMatchObject({ auth_type: "password" });
    sync.start();
    await sync.request("poll");
    await sync.request("poll");
    expect(reads).toHaveBeenLastCalledWith(["~/.ssh/id_new"], "probe");
    files.keys = { "~/.ssh/id_new": { privateKey: PRIVATE, publicKey: null, privateReadable: true } };
    await sync.request("poll");
    sync.stop();
    expect(conns[0]).toMatchObject({ auth_type: "key", key_id: "key-id_new" });
  });

  it("keeps a working key when the key import fails", async () => {
    files.config = "Host web\n  HostName 10.0.0.1\n  IdentityFile ~/.ssh/id_web\n";
    const sync = make();
    await sync.request("manual");
    files.config = "Host web\n  HostName 10.0.0.1\n  IdentityFile ~/.ssh/id_new\n";
    files.keys = { "~/.ssh/id_new": { privateKey: PRIVATE, publicKey: null, privateReadable: true } };
    vi.spyOn(log, "error").mockImplementation(() => {});
    vi.mocked(importIntoVault).mockRejectedValueOnce(new Error("vault locked"));
    const s = await sync.request("manual");
    expect(conns[0]).toMatchObject({ auth_type: "key", key_id: "key-id_web" });
    expect(s!.skipped).toContainEqual({ alias: "web", reason: "key", target: "~/.ssh/id_new" });
  });

  it("pauses when the target vault is gone", async () => {
    disk = JSON.stringify({ joined: JOINED, sync: { on: true, vault: "deleted-vault", at: 1 } });
    expect(await make().request("manual")).toBeNull();
    expect(conns).toEqual([]);
    expect(useSshConfigStore.getState().status.error).toBe("vault");
  });

  it("stop() halts timers and ignores a run in flight", async () => {
    vi.useFakeTimers();
    try {
      const sync = make();
      sync.start();
      sync.stop();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(31_000);
      expect(reads).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }

    const held = gate();
    const sync = make({ sleep: held.sleep });
    sync.start();
    await vi.waitFor(() => expect(held.waiting).toHaveLength(1));
    sync.stop();
    held.open();
    expect(await sync.request("poll")).toBeNull();
    expect(conns).toEqual([]);
  });

  it("polls every 30 s and acts only on a change", async () => {
    vi.useFakeTimers();
    try {
      const sync = make();
      sync.start();
      await vi.waitFor(() => expect(conns).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(30_000);
      reads.mockClear();
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(1));
      expect(conns[0].host).toBe("10.0.0.1");
      files.config = "Host web\n  HostName 10.0.0.2\n  User deploy\n";
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.waitFor(() => expect(conns[0].host).toBe("10.0.0.2"));
      sync.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("claims its presence again when another device resets it, with the file unchanged", async () => {
    vi.useFakeTimers();
    try {
      const sync = make();
      sync.start();
      await vi.waitFor(() => expect(conns).toHaveLength(1));
      const id = conns[0].id;
      const state = JSON.parse(disk!);
      state.managed[id].devices.d1 = { present: false, hash: "", at: NOW };
      disk = JSON.stringify(state);
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.waitFor(() => expect(JSON.parse(disk!).managed[id].devices.d1.present).toBe(true));
      sync.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes this device's heartbeat once a day", async () => {
    await make().request("manual");
    expect(JSON.parse(disk!).seen).toEqual({ d1: NOW });
    await make({ now: () => NOW + 1000 }).request("manual");
    expect(JSON.parse(disk!).seen).toEqual({ d1: NOW });
    await make({ now: () => NOW + 25 * 3600 * 1000 }).request("manual");
    expect(JSON.parse(disk!).seen).toEqual({ d1: NOW + 25 * 3600 * 1000 });
  });

  it("skips ProxyCommand hosts and reports them", async () => {
    files.config += "Host coder\n  ProxyCommand coder ssh --stdio\n";
    const s = await make().request("manual");
    expect(s!.skipped).toContainEqual({ alias: "coder", reason: "proxyCommand", target: "coder:22" });
    expect(conns.map((c) => c.name)).toEqual(["web"]);
  });

  it("leaves an entry alone when this device has never seen its host", async () => {
    disk = JSON.stringify({ joined: JOINED, sync: { on: true, vault: "personal", at: 1 }, managed: { elsewhere: { alias: "web", at: 1, devices: { d1: { present: true, hash: "old", at: 1 } } } } });
    await make().request("manual");
    expect(connApi.saveConnection).not.toHaveBeenCalled();
    expect(connApi.updateConnection).not.toHaveBeenCalled();
    expect(JSON.parse(disk!).managed.elsewhere.gone).toBeUndefined();
  });

  it("detaches a managed host deleted by hand", async () => {
    const sync = make();
    await sync.request("manual");
    const id = conns[0].id;
    await connApi.deleteConnection(id);
    await sync.request("manual");
    expect(JSON.parse(disk!).managed[id].gone).toBe("detached");
    expect(conns).toEqual([]);
  });

  it("drops the jump hosts once the stanza no longer sets ProxyJump", async () => {
    files.config = "Host web\n  HostName 10.0.0.1\n  ProxyJump admin@gw:2200\n";
    const sync = make();
    await sync.request("manual");
    expect(conns[0].jump_hosts).toHaveLength(1);
    files.config = "Host web\n  HostName 10.0.0.1\n";
    await sync.request("manual");
    expect(conns[0].jump_hosts).toEqual([]);
  });

  it("takes a ProxyCommand hop's address from its stanza without linking it", async () => {
    files.config = "Host web\n  HostName 10.0.0.1\n  ProxyJump bastion\nHost bastion\n  HostName 10.1.1.1\n  Port 2222\n  User ops\n  ProxyCommand nc %h %p\n";
    await make().request("manual");
    expect(conns.map((c) => c.name)).toEqual(["web"]);
    expect(conns[0].jump_hosts).toMatchObject([{ connection_id: "", host: "10.1.1.1", port: 2222, username: "ops" }]);
  });

  it("undoes what a run created when saving the state fails, so a restart cannot duplicate it", async () => {
    files.config = TWO_HOSTS;
    const restore = failStateSaves();
    expect(await make().request("manual")).toMatchObject({ created: 0 });
    expect(conns).toEqual([]);
    restore();
    expect(await make().request("manual")).toMatchObject({ created: 2 });
    expect(conns).toHaveLength(2);
    expect(Object.keys(JSON.parse(disk!).managed).sort()).toEqual(conns.map((c) => c.id).sort());
  });

  it("keeps an unsaved delete for the next run", async () => {
    files.config = TWO_HOSTS;
    const sync = make();
    await sync.request("manual");
    const db = conns.find((c) => c.name === "db")!.id;
    const restore = failStateSaves();
    files.config = "Host web\n  HostName 10.0.0.1\n";
    await sync.request("manual");
    restore();
    await sync.request("manual");
    expect(JSON.parse(disk!).managed[db]).toMatchObject({ gone: "removed" });
  });

  it("does not run while account sync is halted", async () => {
    vi.mocked(isSyncHalted).mockReturnValue(true);
    expect(await make().request("manual")).toBeNull();
    expect(conns).toEqual([]);
    vi.mocked(isSyncHalted).mockReturnValue(false);
  });

  it("puts back the key and auth type a write outside the sync changed", async () => {
    files.config = "Host web\n  HostName 10.0.0.1\n  IdentityFile ~/.ssh/id_web\n";
    files.keys = { "~/.ssh/id_web": { privateKey: PRIVATE, publicKey: PUBLIC, privateReadable: true } };
    const sync = make();
    await sync.request("manual");
    expect(JSON.parse(disk!).managed[conns[0].id].devices.d1.key).toBe("key-id_web");
    keyVaults.set("key-other", "personal");
    conns[0] = { ...conns[0], key_id: "key-other" };
    await sync.request("manual");
    expect(conns[0]).toMatchObject({ auth_type: "key", key_id: "key-id_web" });
    conns[0] = { ...conns[0], auth_type: "password" };
    await sync.request("manual");
    expect(conns[0]).toMatchObject({ auth_type: "key", key_id: "key-id_web" });
  });

  it("repairs a host field changed outside the sync", async () => {
    const sync = make();
    await sync.request("manual");
    conns[0] = { ...conns[0], host: "10.9.9.9" };
    await sync.request("manual");
    expect(conns[0]).toMatchObject({ host: "10.0.0.1" });
  });

  it("drops jump hosts another device's stanza set when this device's stanza has none", async () => {
    files.config = "Host web\n  HostName 10.0.0.1\n";
    await make().request("manual");
    const id = conns[0].id;
    const other = fingerprint({ alias: "web", hostname: "10.0.0.7", port: 22, proxyJump: "gw" });
    const state = JSON.parse(disk!);
    state.managed[id].devices = { d2: { present: true, hash: other, at: 1 } };
    disk = JSON.stringify(state);
    conns[0] = { ...conns[0], host: "10.0.0.7", jump_hosts: [{ id: "j", connection_id: "", host: "gw", port: 22, username: "" }] };
    await make().request("manual");
    expect(conns[0]).toMatchObject({ host: "10.0.0.1", jump_hosts: [] });
  });

  it("links ProxyJump hops to the managed hosts they name", async () => {
    files.config = "Host web\n  HostName 10.0.0.1\n  ProxyJump bastion\nHost bastion\n  HostName 10.0.0.254\n";
    await make().request("manual");
    const bastion = conns.find((c) => c.name === "bastion")!;
    expect(conns.find((c) => c.name === "web")!.jump_hosts).toMatchObject([{ connection_id: bastion.id, host: "10.0.0.254" }]);
  });
});

describe("ssh-config sync engine and MCP entry", () => {
  it("starts and stops with the switch", () => {
    const start = vi.spyOn(sshConfigSync, "start").mockImplementation(() => {});
    const stop = vi.spyOn(sshConfigSync, "stop").mockImplementation(() => {});
    useSshConfigStore.getState().setState({});
    const dispose = startSshConfigSyncEngine();
    expect(stop).toHaveBeenCalledTimes(1);
    useSshConfigStore.getState().setState({ sync: { on: true, vault: "personal", at: 2 } });
    useSshConfigStore.getState().setState({ sync: { on: true, vault: "other", at: 3 } });
    expect(start).toHaveBeenCalledTimes(1);
    useSshConfigStore.getState().setState({ sync: { on: false, vault: "other", at: 4 } });
    expect(stop).toHaveBeenCalledTimes(2);
    dispose();
    useSshConfigStore.getState().setState({ sync: { on: true, vault: "other", at: 5 } });
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(3);
  });

  it("refuses on Android and when the setting is off, and runs a forced sync otherwise", async () => {
    const request = vi.spyOn(sshConfigSync, "request").mockResolvedValue({ created: 0, updated: 0, removed: 0, managed: 1, skipped: [] });
    vi.mocked(getPlatform).mockResolvedValueOnce("android");
    expect(await sshConfigSyncNow()).toMatchObject({ ok: false });
    disk = null;
    expect(await sshConfigSyncNow()).toEqual({ ok: false, error: "Continuous sync is off; turn it on in Settings › Hosts" });
    expect(request).not.toHaveBeenCalled();
    disk = JSON.stringify({ joined: JOINED, sync: { on: true, vault: "personal", at: 1 } });
    expect(await sshConfigSyncNow()).toMatchObject({ ok: true, result: { managed: 1 } });
    expect(request).toHaveBeenCalledWith("mcp");
  });
});

describe("ssh-config sync runner against another computer", () => {
  const ALIASES = ["web", "db", "api"];
  const configOf = (hosts: SshConfigHost[]) => hosts.map((h) => `Host ${h.alias}\n  HostName ${h.hostname}\n`).join("");
  const stateOnDisk = (): SshConfigState => JSON.parse(disk!);

  // The other computer's writes reach this one as separate state and connection pulls, in any order and mid-run.
  async function simulate(seed: number) {
    const random = prng(seed);
    const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
    let serial = 0;
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}` as ReturnType<typeof crypto.randomUUID>);
    let clock = NOW;
    const hostsFrom = () => ALIASES.filter(() => random() < 0.5).map((alias) => ({ alias, hostname: pick(["10.0.0.1", "10.0.0.2"]), port: 22 }));
    let mine = hostsFrom();
    let theirs = hostsFrom();
    const stateArrivals: SshConfigState[] = [];
    const connArrivals: (() => void)[] = [];
    const deliverState = () => { for (const patch of stateArrivals.splice(0)) disk = JSON.stringify(mergeSshConfigState(patch, stateOnDisk(), clock)); };
    const deliverConns = () => connArrivals.splice(0).forEach((apply) => apply());
    const deliverSome = () => { if (random() < 0.5) deliverState(); if (random() < 0.5) deliverConns(); };
    const otherRuns = () => {
      clock += 1_000;
      const plan = reconcile({ hosts: theirs, all: theirs, connections: structuredClone(conns), deleted: Object.fromEntries(deletedIds.map((id) => [id, new Date(clock).toISOString()])), state: stateOnDisk(), device: "d2", now: clock, deleteAllowed: true });
      const managed: Record<string, ManagedEntry> = { ...plan.managed };
      for (const host of plan.creates) {
        const c = connectionFromForm({ tags: [], jump_hosts: [], env_vars: [], agent_forwarding: false, legacy_algorithms: false, ask_vars_each_time: false, name: host.alias, host: host.hostname, port: 22, username: "", auth_type: "password", connection_type: "ssh", vault_id: "personal" }, { id: crypto.randomUUID(), now: "2026-10-14T00:00:00Z" });
        managed[c.id] = { alias: host.alias, at: clock, devices: { d2: { present: true, hash: fingerprint(host), at: clock } } };
        connArrivals.push(() => conns.push(c));
      }
      for (const u of plan.updates) connArrivals.push(() => { conns = conns.map((c) => (c.id === u.id ? { ...c, host: u.host.hostname } : c)); });
      for (const id of plan.deletes) connArrivals.push(() => { conns = conns.filter((c) => c.id !== id); deletedIds.push(id); });
      stateArrivals.push({ managed, seen: { d2: clock } });
    };
    const list = vi.mocked(connApi.listConnections);
    list.mockImplementation(async () => {
      const seen = structuredClone(conns);
      deliverSome();
      return seen;
    });
    const sync = make({ now: () => clock });
    const poll = async () => {
      clock += 1_000;
      files = fresh({ config: configOf(mine) });
      return sync.request("poll");
    };
    sync.start();
    try {
      for (let step = 0; step < 25; step++) {
        const roll = random();
        if (roll < 0.15) mine = hostsFrom();
        else if (roll < 0.3) theirs = hostsFrom();
        else if (roll < 0.55) otherRuns();
        else if (roll < 0.7) deliverSome();
        else await poll();
      }
      for (let round = 0; round < 6; round++) {
        deliverState();
        deliverConns();
        otherRuns();
        deliverState();
        deliverConns();
        await poll();
        await poll();
      }
      const before = disk;
      await poll();
      const state = stateOnDisk();
      const live = Object.entries(state.managed ?? {}).filter(([id, e]) => !e.gone && conns.some((c) => c.id === id));
      for (const alias of new Set([...mine, ...theirs].map((h) => h.alias))) {
        expect(live.filter(([, e]) => e.alias === alias), `seed ${seed}: ${alias}`).toHaveLength(1);
      }
      for (const host of mine) {
        const [, e] = live.find(([, x]) => x.alias === host.alias)!;
        expect(e.devices.d1, `seed ${seed}: ${host.alias}`).toMatchObject({ present: true, hash: fingerprint(host) });
      }
      expect(useSshConfigStore.getState().status.skipped.filter((x) => x.reason === "pending"), `seed ${seed}`).toEqual([]);
      expect(disk, `seed ${seed}: still changing`).toBe(before);
    } finally {
      sync.stop();
      list.mockImplementation(async () => structuredClone(conns));
    }
  }

  it("records every alias once and settles, whatever order the other computer's changes arrive in", async () => {
    for (let seed = 1; seed <= 200; seed++) {
      conns = [];
      deletedIds = [];
      disk = JSON.stringify({ joined: JOINED, sync: { on: true, vault: "personal", at: 1 } });
      await simulate(seed);
    }
  }, 60_000);
});
