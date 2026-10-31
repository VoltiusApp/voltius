// @vitest-environment jsdom
import { routeVaultSecret } from "@/test/vaultSecretRoute";
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch, isAbortError: () => false }));
vi.mock("@/services/teamDataManager", () => ({ onTeamLogin: vi.fn(async () => {}), onSessionEnd: vi.fn() }));
vi.mock("@/services/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/identity")>()),
  ensureIdentity: vi.fn(async () => ({ stored: true, proven: true })),
}));

import {
  LAN_GROUP_FILE,
  createGroupIfNeeded,
  dropGroupSecrets,
  farewellSent,
  forgetMember,
  grantFor,
  holdsGroupSecrets,
  joinGroup,
  keyStillHeld,
  leaveGroup,
  markLeft,
  markMoved,
  localEntityCount,
  pairInfo,
  readFarewell,
  readGroup,
  replacedMember,
  type GroupGrant,
} from "./lanGroup";
import { linkToCloud, openWithStoredSecret, setMasterPassword, settleVaultOnDek } from "./account";
import { ENTITY_FILES, mergeBlobPayload, parseEntities, type BlobPayload } from "./sync";
import { getLocalSecret, getVaultKey, lockVault, setVaultKey } from "./vault";
import { isAlive } from "./crdt";
import { useVaultKeysStore } from "@/stores/vaultKeysStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { GLOBAL_PROXY_PASSWORD_KEY as PROXY_KEY } from "./teamVaultSecretKeys";
import { LAN_FAREWELL_ENTRY } from "./accountCacheKeys";

const SELF = "self-device";
const HOST = "host-device";
const SELF_KEY = "ab".repeat(32);
const HOST_KEY = "cd".repeat(32);
const OLD = "2026-01-01T00:00:00.000Z";
const MINE = ["password", "mine"].join(":");
const THEIRS = ["password", "theirs"].join(":");

const bytes = (n: number) => Array.from({ length: 32 }, (_, i) => (n + i) & 255);
const hex = (key: number[]) => key.map((b) => b.toString(16).padStart(2, "0")).join("");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const kekFor = (password: string) => bytes(password.length * 7);
const G = bytes(200);
const K = bytes(50);
const DEK = bytes(99);

interface Disk { key: number[] | null; files: Record<string, string>; secrets: Record<string, string>; clocks: Record<string, string> }

let keychain: Record<string, string | null>;
let disk: Disk;
let unlockedWith: number[] | null;
let failing: ((cmd: string, args: Record<string, unknown>) => boolean) | null;
let crash: { at: (cmd: string, args: Record<string, unknown>) => boolean; applied: boolean } | null;
let crashed: string | null;

const WRONG_KEY = { code: "vault-unreadable", message: "Decryption failed — wrong key or corrupted file" };
const LOCKED = { code: "vault-locked", message: "locked" };

function needOpen() {
  if (!unlockedWith) throw LOCKED;
}

function backend(cmd: string, args: Record<string, unknown> = {}): unknown {
  if (failing?.(cmd, args)) throw new Error(`injected ${cmd}`);
  const vs = routeVaultSecret(keychain, cmd, args);
  if (vs.handled) return vs.value;
  switch (cmd) {
    case "keychain_get":
      return keychain[args.key as string] ?? null;
    case "keychain_set":
      keychain[args.key as string] = args.value as string;
      return undefined;
    case "keychain_delete":
      delete keychain[args.key as string];
      return undefined;
    case "secrets_exists":
      return disk.key !== null;
    case "secrets_verify":
      if (!same(args.encKey, disk.key)) throw WRONG_KEY;
      return undefined;
    case "secrets_unlock":
      if (disk.key && !same(args.encKey, disk.key)) throw WRONG_KEY;
      disk.key ??= args.encKey as number[];
      unlockedWith = args.encKey as number[];
      return undefined;
    case "secrets_lock":
      unlockedWith = null;
      return undefined;
    case "secrets_rekey":
      needOpen();
      if (!same(args.oldEncKey, disk.key)) throw WRONG_KEY;
      disk.key = unlockedWith = args.newEncKey as number[];
      return undefined;
    case "secrets_reencrypt":
      needOpen();
      disk.key = unlockedWith = args.newEncKey as number[];
      return undefined;
    case "secrets_get":
      needOpen();
      return disk.secrets[args.key as string] ?? null;
    case "secrets_set":
      needOpen();
      disk.secrets[args.key as string] = args.value as string;
      disk.clocks[args.key as string] = new Date().toISOString();
      return undefined;
    case "state_export_raw":
      needOpen();
      return {
        files: Object.fromEntries(ENTITY_FILES.map((f) => [f, disk.files[f] ?? "[]"])),
        secrets: { ...disk.secrets },
        secret_clocks: { ...disk.clocks },
      };
    case "state_import": {
      needOpen();
      const { files, secrets, secretClocks } = args as { files: Record<string, string>; secrets: Record<string, string>; secretClocks: Record<string, string> };
      for (const [name, content] of Object.entries(files)) if ((ENTITY_FILES as readonly string[]).includes(name)) disk.files[name] = content;
      disk.secrets = { ...secrets };
      disk.clocks = { ...secretClocks };
      return undefined;
    }
    case "derive_keys":
      return { auth_key: "AUTH", enc_key: kekFor(args.password as string) };
    case "derive_x25519_keypair":
      return { public_key: "PUB", private_key: btoa(String.fromCharCode(...(args.encKey as number[]).slice().reverse())) };
    case "wrap_user_secrets_cmd":
      return JSON.stringify({ kek: args.kek, dek: args.dek, x: args.x25519Private });
    case "unwrap_user_secrets_cmd": {
      const wrapped = JSON.parse(args.wrappedB64 as string);
      if (!same(wrapped.kek, args.kek)) throw new Error("unwrap failed");
      return { dek: wrapped.dek, x25519_private: wrapped.x };
    }
    case "device_hostname":
      return "laptop";
    case "lan_sync_device_key":
      return SELF_KEY;
    case "generate_user_secrets_cmd":
      return { dek: DEK, x25519_private: bytes(7), x25519_public: "X" };
    default:
      return cmd.endsWith("_list") ? [] : null;
  }
}

function halt(cmd: string): Promise<never> {
  crashed = cmd;
  return new Promise(() => {});
}

function relaunch() {
  unlockedWith = null;
  useVaultKeysStore.getState().clear();
  setVaultKey([0]);
  crash = null;
}

const calls = (cmd: string) => h.invoke.mock.calls.filter(([c]) => c === cmd).map(([, a]) => a);

function entity(id: string, fields: Record<string, unknown>, at = OLD) {
  return { id, ...fields, updated_at: at, clocks: Object.fromEntries(Object.keys(fields).map((k) => [k, at])) };
}

function noPasswordDevice(key = K) {
  keychain.account_id = "acc-self";
  keychain.mode = "local-nopassword";
  keychain.master_password = hex(key);
  disk.key = key;
  setVaultKey(key);
}

function passwordDevice(password = "pw") {
  keychain.account_id = "acc-self";
  keychain.mode = "local";
  keychain.master_password = password;
  disk.key = kekFor(password);
  setVaultKey(kekFor(password));
}

function withData(id: string, secret: string) {
  disk.files["connections.json"] = JSON.stringify([entity(id, { name: id })]);
  disk.secrets[secret] = "s3cret";
  disk.clocks[secret] = OLD;
}

const grant: GroupGrant = {
  groupId: "group-1",
  vaultKey: hex(G),
  secrets: [{ epoch: 2, secret: "22".repeat(32) }, { epoch: 1, secret: "11".repeat(32) }],
  hostName: "Desktop",
};

function hostPayload(): BlobPayload {
  return {
    files: {
      "connections.json": JSON.stringify([entity("host-conn", { name: "host-conn" })]),
      [LAN_GROUP_FILE]: JSON.stringify([
        entity("group", { kind: "group", group_id: "group-1" }),
        entity(HOST, { kind: "member", name: "Desktop", platform: "linux", device_key: HOST_KEY, joined_at: OLD }),
      ]),
    },
    secrets: { [THEIRS]: "theirs", "lan-group-secret:1": "11".repeat(32), "lan-group-secret:2": "22".repeat(32) },
    secret_clocks: { [THEIRS]: OLD, "lan-group-secret:1": OLD, "lan-group-secret:2": OLD },
  };
}

const ids = (file: string) => JSON.parse(disk.files[file] ?? "[]").map((e: { id: string }) => e.id).sort();

beforeEach(() => {
  h.invoke.mockReset();
  h.appFetch.mockReset();
  h.appFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ jwt_token: "J", refresh_token: "R" }) });
  keychain = {};
  disk = { key: null, files: {}, secrets: {}, clocks: {} };
  unlockedWith = null;
  failing = null;
  crash = null;
  crashed = null;
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    const stop = crash?.at(cmd, args) ? crash : null;
    if (stop && !stop.applied) return halt(cmd);
    const out = backend(cmd, args);
    return stop ? halt(cmd) : out;
  });
  localStorage.setItem("voltius.device_id", SELF);
  useVaultKeysStore.getState().clear();
  useSyncPrefsStore.setState({ syncTypes: {}, excludedIds: [], syncSettingDomains: {}, settingSyncOverrides: {} });
  setVaultKey([0]);
});

test("create_group_moves_password_vault_to_fresh_key", async () => {
  passwordDevice();
  withData("mine", MINE);

  const group = await createGroupIfNeeded();

  const fresh = getVaultKey()!;
  expect(fresh).toHaveLength(32);
  expect(fresh).not.toEqual(kekFor("pw"));
  expect(calls("secrets_rekey")).toEqual([{ oldEncKey: kekFor("pw"), newEncKey: fresh }]);
  expect(disk.key).toEqual(fresh);
  expect(JSON.parse(keychain.wrapped_user_secrets!)).toMatchObject({ kek: kekFor("pw"), dek: fresh });
  expect(useVaultKeysStore.getState()).toMatchObject({ dek: fresh, kek: kekFor("pw") });
  expect(await getLocalSecret(MINE)).toBe("s3cret");
  expect(group.groupId).toMatch(/.+/);
  expect(group.members.map((m) => [m.id, m.device_key, m.name])).toEqual([[SELF, SELF_KEY, "laptop"]]);
  expect(group.secrets.map((s) => [s.epoch, s.secret.length])).toEqual([[1, 32]]);
  expect(await readGroup()).toEqual(group);
});

test("create_group_keeps_nopassword_key", async () => {
  noPasswordDevice();

  const group = await createGroupIfNeeded();

  expect(calls("secrets_rekey")).toEqual([]);
  expect(calls("secrets_reencrypt")).toEqual([]);
  expect(getVaultKey()).toEqual(K);
  expect(keychain.wrapped_user_secrets).toBeUndefined();
  const issued = await grantFor(group, "Desktop");
  expect(issued).toEqual({
    groupId: group.groupId,
    vaultKey: hex(K),
    secrets: [{ epoch: 1, secret: hex(group.secrets[0].secret) }],
    hostName: "Desktop",
  });
  expect(issued.secrets[0].secret).toMatch(/^[0-9a-f]{64}$/);
  expect(await createGroupIfNeeded()).toEqual(group);
});

test("create_group_refuses_a_signed_in_device", async () => {
  noPasswordDevice();
  keychain.mode = "server";
  await expect(createGroupIfNeeded()).rejects.toThrow();
  expect(await readGroup()).toBeNull();
});

test("join_combine_reencrypts_and_keeps_both", async () => {
  noPasswordDevice();
  withData("mine", MINE);

  await joinGroup(grant, "combine", [HOST, hostPayload()]);

  expect(calls("secrets_rekey")).toEqual([{ oldEncKey: K, newEncKey: G }]);
  expect(disk.key).toEqual(G);
  expect(getVaultKey()).toEqual(G);
  expect(keychain.master_password).toBe(hex(G));
  expect(ids("connections.json")).toEqual(["host-conn", "mine"]);
  expect(await getLocalSecret(MINE)).toBe("s3cret");
  expect(await getLocalSecret(THEIRS)).toBe("theirs");
  const group = await readGroup();
  expect(group?.groupId).toBe("group-1");
  expect(group?.members.map((m) => m.id).sort()).toEqual([HOST, SELF]);
  expect(group?.secrets.map((s) => [s.epoch, hex(s.secret)])).toEqual([[2, "22".repeat(32)], [1, "11".repeat(32)]]);
  expect(await localEntityCount()).toBe(2);
  expect(await pairInfo()).toEqual({ mode: "none", group: "group-1", entities: 2, members: 2 });
});

test("join_combine_without_host_data_waits_for_the_first_blob", async () => {
  noPasswordDevice();
  withData("mine", MINE);

  await joinGroup(grant, "combine");

  expect(ids("connections.json")).toEqual(["mine"]);
  expect((await readGroup())?.members.map((m) => m.id)).toEqual([SELF]);
});

test("join_replace_uses_replace_flow", async () => {
  noPasswordDevice();
  withData("mine", MINE);
  disk.secrets[PROXY_KEY] = "proxy-pw";
  disk.clocks[PROXY_KEY] = OLD;

  await joinGroup(grant, "replace", [HOST, hostPayload()]);

  expect(ids("connections.json")).toEqual(["host-conn"]);
  expect(await getLocalSecret(MINE)).toBeNull();
  expect(await getLocalSecret(THEIRS)).toBe("theirs");
  expect(await getLocalSecret(PROXY_KEY)).toBe("proxy-pw");
  expect(disk.key).toEqual(G);
  const group = await readGroup();
  expect(group?.members.map((m) => m.id).sort()).toEqual([HOST, SELF]);
  expect(group?.secrets.map((s) => s.epoch)).toEqual([2, 1]);
});

const persistFails = {
  "local-nopassword": (cmd: string) => cmd === "vault_secret_import",
  local: (cmd: string, args: Record<string, unknown>) => cmd === "keychain_set" && args.key === "wrapped_user_secrets",
};
const devices = { "local-nopassword": noPasswordDevice, local: passwordDevice };
const MODES = ["local-nopassword", "local"] as const;

function expectUntouched(before: number[], storedBefore: string | null | undefined) {
  expect(getVaultKey()).toEqual(before);
  expect(disk.key).toEqual(before);
  expect(keychain.master_password).toBe(storedBefore);
  expect(keychain.wrapped_user_secrets).toBeUndefined();
  expect(keychain.vault_key_pending).toBeUndefined();
  expect(useVaultKeysStore.getState().dek).toBeNull();
}

test.each(MODES)("join_failure_keeps_old_key_working (%s)", async (mode) => {
  devices[mode]();
  withData("mine", MINE);
  const before = getVaultKey()!;
  const storedBefore = keychain.master_password;
  failing = persistFails[mode];

  await expect(joinGroup(grant, "combine", [HOST, hostPayload()])).rejects.toThrow(/injected/);

  expect(calls("secrets_rekey")).toEqual(
    mode === "local" ? [] : [{ oldEncKey: before, newEncKey: G }, { oldEncKey: G, newEncKey: before }],
  );
  expectUntouched(before, storedBefore);
  failing = null;
  expect(await getLocalSecret(MINE)).toBe("s3cret");
  expect(ids("connections.json")).toEqual(["mine"]);
  expect(await readGroup()).toBeNull();
});

test.each(MODES)("join_crash_after_the_rekey_still_opens_on_relaunch (%s)", async (mode) => {
  devices[mode]();
  withData("mine", MINE);
  crash = mode === "local"
    ? { at: (cmd) => cmd === "secrets_rekey", applied: true }
    : { at: persistFails["local-nopassword"], applied: false };

  void joinGroup(grant, "combine", [HOST, hostPayload()]);
  await vi.waitFor(() => expect(crashed).not.toBeNull());
  expect(disk.key).toEqual(G);

  relaunch();
  expect(await openWithStoredSecret(keychain.master_password!)).toBe("ok");
  expect(getVaultKey()).toEqual(G);
  expect(await getLocalSecret(MINE)).toBe("s3cret");
  expect(keychain.vault_key_pending).toBeUndefined();
  if (mode === "local-nopassword") {
    expect(keychain.master_password).toBe(hex(G));
    relaunch();
    expect(await openWithStoredSecret(keychain.master_password!)).toBe("ok");
    expect(getVaultKey()).toEqual(G);
  }
});

test.each(MODES)("join_crash_before_the_rekey_opens_with_the_old_key (%s)", async (mode) => {
  devices[mode]();
  withData("mine", MINE);
  const before = getVaultKey()!;
  crash = { at: (cmd) => cmd === "secrets_rekey", applied: false };

  void joinGroup(grant, "combine", [HOST, hostPayload()]);
  await vi.waitFor(() => expect(crashed).not.toBeNull());

  relaunch();
  expect(await openWithStoredSecret(keychain.master_password!)).toBe("ok");
  expect(getVaultKey()).toEqual(before);
  expect(await getLocalSecret(MINE)).toBe("s3cret");
  expect(keychain.vault_key_pending).toBeUndefined();
});

test("set_master_password_crash_after_reencrypt_still_opens_on_relaunch", async () => {
  noPasswordDevice();
  withData("mine", MINE);
  crash = { at: (cmd) => cmd === "vault_secret_import", applied: false };

  void setMasterPassword("chosen");
  await vi.waitFor(() => expect(crashed).not.toBeNull());
  expect(disk.key).toEqual(kekFor("chosen"));

  relaunch();
  expect(await openWithStoredSecret(keychain.master_password!)).toBe("ok");
  expect(await getLocalSecret(MINE)).toBe("s3cret");
});

test.each(MODES.flatMap((mode) => ["secrets_rekey", "lan_sync_device_key"].map((cmd) => [mode, cmd] as const)))(
  "join_failure_before_the_move_changes_nothing (%s, %s)",
  async (mode, failingCmd) => {
    devices[mode]();
    withData("mine", MINE);
    const before = getVaultKey()!;
    const storedBefore = keychain.master_password;
    failing = (cmd) => cmd === failingCmd;

    await expect(joinGroup(grant, "replace", [HOST, hostPayload()])).rejects.toThrow(/injected/);

    expectUntouched(before, storedBefore);
    expect(ids("connections.json")).toEqual(["mine"]);
  },
);

test("join_refuses_a_device_already_in_a_group", async () => {
  noPasswordDevice();
  await createGroupIfNeeded();

  await expect(joinGroup(grant, "combine", [HOST, hostPayload()])).rejects.toThrow(/already in lan group/);
  expect(calls("secrets_rekey")).toEqual([]);
  expect(getVaultKey()).toEqual(K);
});

test("join_opens_a_lazily_loaded_vault_before_moving_it", async () => {
  noPasswordDevice();
  withData("mine", MINE);

  await joinGroup(grant, "combine");

  const order = h.invoke.mock.calls.map(([c]) => c);
  expect(order.indexOf("secrets_unlock")).toBeGreaterThanOrEqual(0);
  expect(order.indexOf("secrets_unlock")).toBeLessThan(order.indexOf("secrets_rekey"));
  expect(order.indexOf("state_export_raw")).toBeLessThan(order.indexOf("secrets_rekey"));
});

function leftGroupState(self: "moved" | "forgotten") {
  const selfFields = { kind: "member", name: "laptop", platform: "linux", device_key: SELF_KEY, joined_at: OLD };
  const me = entity(SELF, self === "moved" ? { ...selfFields, moved_at: OLD } : selfFields);
  const gone = self === "forgotten" ? { ...me, deleted_at: OLD, clocks: { ...me.clocks, __deleted__: OLD } } : me;
  disk.files[LAN_GROUP_FILE] = JSON.stringify([
    entity("group", { kind: "group", group_id: "old-group" }),
    gone,
    entity("old-peer", { kind: "member", name: "Old", platform: "linux", device_key: "ef".repeat(32), joined_at: OLD }),
  ]);
  for (const epoch of [1, 2, 3]) {
    disk.secrets[`lan-group-secret:${epoch}`] = "99".repeat(32);
    disk.clocks[`lan-group-secret:${epoch}`] = OLD;
  }
}

test("rejoin_after_leave_clears_moved_and_old_epochs", async () => {
  noPasswordDevice();
  leftGroupState("moved");
  expect(await readGroup()).toBeNull();

  await joinGroup(grant, "combine", [HOST, hostPayload()]);

  const group = (await readGroup())!;
  expect(group.groupId).toBe("group-1");
  expect(group.members.find((m) => m.id === SELF)?.moved_at).toBeFalsy();
  expect(group.members.filter(isAlive).map((m) => m.id).sort()).toEqual([HOST, SELF]);
  expect(group.secrets.map((s) => [s.epoch, hex(s.secret)])).toEqual([[2, "22".repeat(32)], [1, "11".repeat(32)]]);
  expect(disk.secrets["lan-group-secret:3"]).toBeUndefined();
  expect(disk.clocks["lan-group-secret:3"]).toBe("2026-01-01T00:00:00.001Z");
});

test("rejoin_same_group_keeps_its_members", async () => {
  noPasswordDevice();
  leftGroupState("moved");
  const sameGroup = { ...grant, groupId: "old-group" };

  await joinGroup(sameGroup, "combine");

  const group = (await readGroup())!;
  expect(group.members.filter(isAlive).map((m) => m.id).sort()).toEqual(["old-peer", SELF]);
  expect(disk.secrets["lan-group-secret:3"]).toBe("99".repeat(32));
  expect(disk.clocks["lan-group-secret:3"]).toBe(OLD);
});

test.each(["combine", "replace"] as const)("rejoin_new_group_keeps_a_host_that_was_an_old_peer (%s)", async (choice) => {
  noPasswordDevice();
  leftGroupState("moved");
  const older = "2025-06-01T00:00:00.000Z";
  const lan = JSON.parse(disk.files[LAN_GROUP_FILE]);
  lan.push(entity(HOST, { kind: "member", name: "Desktop", platform: "linux", device_key: HOST_KEY, joined_at: older }, older));
  disk.files[LAN_GROUP_FILE] = JSON.stringify(lan);
  const host = hostPayload();

  await joinGroup(grant, choice, [HOST, host]);

  const group = (await readGroup())!;
  expect(group.members.filter(isAlive).map((m) => m.id).sort()).toEqual([HOST, SELF]);
  expect(group.members.find((m) => m.id === "old-peer")?.deleted_at).toBeTruthy();
  const exported = backend("state_export_raw") as BlobPayload;
  const onHost = parseEntities(mergeBlobPayload(host, exported).payload.files[LAN_GROUP_FILE]);
  expect(onHost.filter(isAlive).map((e) => e.id).sort()).toEqual(["group", HOST, SELF]);
});

test("create_after_leave_starts_clean", async () => {
  noPasswordDevice();
  leftGroupState("forgotten");
  expect(await readGroup()).toBeNull();

  const group = await createGroupIfNeeded();

  expect(group.groupId).not.toBe("old-group");
  expect(group.members.filter(isAlive).map((m) => m.id)).toEqual([SELF]);
  expect(group.secrets.map((s) => s.epoch)).toEqual([1]);
  expect(hex(group.secrets[0].secret)).not.toBe("99".repeat(32));
  expect(disk.secrets["lan-group-secret:2"]).toBeUndefined();
  expect(disk.secrets["lan-group-secret:3"]).toBeUndefined();
});

test("password_member_reopens_with_group_key", async () => {
  passwordDevice("pw");
  withData("mine", MINE);
  await joinGroup(grant, "combine", [HOST, hostPayload()]);
  expect(JSON.parse(keychain.wrapped_user_secrets!)).toMatchObject({ kek: kekFor("pw"), dek: G });
  expect(keychain.master_password).toBe("pw");

  useVaultKeysStore.getState().clear();
  setVaultKey([0]);
  expect(await openWithStoredSecret("pw")).toBe("ok");

  expect(getVaultKey()).toEqual(G);
  expect(useVaultKeysStore.getState()).toMatchObject({ dek: G, kek: kekFor("pw") });
  expect(await getLocalSecret(MINE)).toBe("s3cret");
  expect(await openWithStoredSecret("wrong")).toBe("wrong-key");
});

test("set_master_password_keeps_group_key", async () => {
  noPasswordDevice();
  await createGroupIfNeeded();
  withData("mine", MINE);

  await setMasterPassword("chosen");

  expect(calls("secrets_reencrypt")).toEqual([]);
  expect(calls("secrets_rekey")).toEqual([]);
  expect(disk.key).toEqual(K);
  expect(getVaultKey()).toEqual(K);
  expect(keychain.mode).toBe("local");
  expect(keychain.master_password).toBe("chosen");
  expect(JSON.parse(keychain.wrapped_user_secrets!)).toMatchObject({ kek: kekFor("chosen"), dek: K });

  useVaultKeysStore.getState().clear();
  setVaultKey([0]);
  expect(await openWithStoredSecret("chosen")).toBe("ok");
  expect(getVaultKey()).toEqual(K);
  expect(await readGroup()).not.toBeNull();
});

test("set_master_password_without_a_group_still_moves_to_the_password_key", async () => {
  noPasswordDevice();

  await setMasterPassword("chosen");

  expect(calls("secrets_reencrypt")).toEqual([{ newEncKey: kekFor("chosen") }]);
  expect(getVaultKey()).toEqual(kekFor("chosen"));
  expect(keychain.wrapped_user_secrets).toBeUndefined();
});

test("forget_member_rotates_and_tombstones", async () => {
  noPasswordDevice();
  await createGroupIfNeeded();
  const lan = JSON.parse(disk.files[LAN_GROUP_FILE]);
  lan.push(entity("other", { kind: "member", name: "Phone", platform: "android", device_key: HOST_KEY, joined_at: OLD }));
  disk.files[LAN_GROUP_FILE] = JSON.stringify(lan);
  disk.clocks["lan-group-secret:1"] = OLD;
  for (let epoch = 2; epoch <= 16; epoch++) {
    disk.secrets[`lan-group-secret:${epoch}`] = hex(bytes(epoch));
    disk.clocks[`lan-group-secret:${epoch}`] = OLD;
  }

  await forgetMember("other");

  const group = (await readGroup())!;
  const other = group.members.find((m) => m.id === "other")!;
  expect(other.deleted_at).toBeTruthy();
  expect(isAlive(other)).toBe(false);
  expect(isAlive(group.members.find((m) => m.id === SELF)!)).toBe(true);
  expect(group.secrets.map((s) => s.epoch)).toEqual([17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  expect(group.secrets[0].secret).toHaveLength(32);
  expect(disk.secrets["lan-group-secret:1"]).toBeUndefined();
  expect(disk.clocks["lan-group-secret:1"]).toBeTruthy();
  expect((await pairInfo()).members).toBe(1);
});

test("moved_presence_marks_only_live_members", async () => {
  noPasswordDevice();
  await createGroupIfNeeded();
  const lan = JSON.parse(disk.files[LAN_GROUP_FILE]);
  const member = (id: string) => entity(id, { kind: "member", name: id, platform: "linux", device_key: HOST_KEY, joined_at: OLD });
  lan.push(member("live"), { ...member("gone"), deleted_at: OLD });
  disk.files[LAN_GROUP_FILE] = JSON.stringify(lan);

  await markMoved("live");
  await markMoved("gone");
  await markMoved("stranger");

  const members = (await readGroup())!.members;
  const live = members.find((m) => m.id === "live")!;
  const gone = members.find((m) => m.id === "gone")!;
  expect(live.moved_at).toBeTruthy();
  expect(isAlive(live)).toBe(true);
  expect(gone.moved_at).toBeUndefined();
  expect(isAlive(gone)).toBe(false);
  expect(members.some((m) => m.id === "stranger")).toBe(false);
  const movedAt = live.moved_at;
  await markMoved("live");
  expect((await readGroup())!.members.find((m) => m.id === "live")!.moved_at).toBe(movedAt);
});

test("leave_group_marks_moved_and_keeps_a_farewell_key", async () => {
  noPasswordDevice();
  const group = await createGroupIfNeeded();

  await leaveGroup("account");

  expect(await readGroup()).toBeNull();
  const self = JSON.parse(disk.files[LAN_GROUP_FILE]).find((e: { id: string }) => e.id === SELF);
  expect(self.moved_at).toBeTruthy();
  expect(disk.secrets["lan-group-secret:1"]).toBe(hex(group.secrets[0].secret));
  expect(await readFarewell()).toEqual({ secret: hex(group.secrets[0].secret), reason: "account", group: group.groupId });
});

test("farewell_key_expires_after_thirty_days", async () => {
  const day = 24 * 3600 * 1000;
  keychain.lan_sync_farewell = JSON.stringify({ secret: "11".repeat(32), at: new Date(Date.now() - 29 * day).toISOString() });
  expect(await readFarewell()).toEqual({ secret: "11".repeat(32), reason: "account" });

  keychain.lan_sync_farewell = JSON.stringify({ secret: "11".repeat(32), at: new Date(Date.now() - 31 * day).toISOString() });
  expect(await readFarewell()).toBeNull();
  expect(keychain.lan_sync_farewell).toBeUndefined();
});

test("a group that lost every epoch secret is never replaced by a new one", async () => {
  noPasswordDevice();
  await createGroupIfNeeded();
  delete disk.secrets["lan-group-secret:1"];
  delete disk.clocks["lan-group-secret:1"];
  const before = structuredClone(disk);

  const group = await createGroupIfNeeded();

  expect(group.secrets).toEqual([]);
  expect(disk).toEqual(before);
  expect((await pairInfo()).group).toBe(group.groupId);
});

test("ungrouped_device_reports_its_entities", async () => {
  noPasswordDevice();
  withData("mine", MINE);
  expect(await readGroup()).toBeNull();
  expect(await pairInfo()).toEqual({ mode: "none", group: null, entities: 1, members: 0 });
});

test("linking_a_grouped_password_device_moves_its_vault_off_the_group_key", async () => {
  passwordDevice("pw");
  withData("mine", MINE);
  await joinGroup(grant, "combine");

  await linkToCloud("me@example.com", "https://sync.example.com");

  expect(disk.key).toEqual(DEK);
  expect(getVaultKey()).toEqual(DEK);
  expect(JSON.parse(keychain.wrapped_user_secrets!)).toMatchObject({ kek: kekFor("pw"), dek: DEK });
  useVaultKeysStore.getState().clear();
  setVaultKey([0]);
  expect(await openWithStoredSecret("pw")).toBe("ok");
  expect(await getLocalSecret(MINE)).toBe("s3cret");
});

test("linking_a_locked_grouped_vault_refuses_instead_of_stranding_it", async () => {
  passwordDevice("pw");
  await joinGroup(grant, "combine");
  const wrapped = keychain.wrapped_user_secrets;
  await lockVault();

  await expect(linkToCloud("me@example.com", "https://sync.example.com")).rejects.toThrow();

  expect(h.appFetch).not.toHaveBeenCalled();
  expect(keychain.wrapped_user_secrets).toBe(wrapped);
  expect(keychain.mode).toBe("local");
  expect(disk.key).toEqual(G);
});

test("password_open_clears_a_stale_pending_key", async () => {
  passwordDevice("pw");
  keychain.vault_key_pending = hex(G);

  expect(await openWithStoredSecret("pw")).toBe("ok");

  expect(keychain.vault_key_pending).toBeUndefined();
});

test("set_master_password_crash_after_the_mode_write_leaves_no_pending_key_behind", async () => {
  noPasswordDevice();
  withData("mine", MINE);
  crash = { at: (cmd, args) => cmd === "keychain_delete" && args.key === "vault_key_pending", applied: false };

  void setMasterPassword("chosen");
  await vi.waitFor(() => expect(crashed).not.toBeNull());
  expect(keychain.mode).toBe("local");
  expect(keychain.vault_key_pending).toBe(hex(kekFor("chosen")));

  relaunch();
  expect(await openWithStoredSecret("chosen")).toBe("ok");
  expect(keychain.vault_key_pending).toBeUndefined();
  expect(await getLocalSecret(MINE)).toBe("s3cret");
});

test("join_keeps_the_pending_key_when_the_undo_also_fails", async () => {
  noPasswordDevice();
  withData("mine", MINE);
  failing = (cmd, args) => cmd === "vault_secret_import" || (cmd === "secrets_rekey" && same(args.oldEncKey, G));

  await expect(joinGroup(grant, "combine", [HOST, hostPayload()])).rejects.toThrow(/injected vault_secret_import/);

  expect(disk.key).toEqual(G);
  expect(keychain.master_password).toBe(hex(K));
  expect(keychain.vault_key_pending).toBe(hex(G));
  failing = null;
  relaunch();
  expect(await openWithStoredSecret(keychain.master_password!)).toBe("ok");
  expect(getVaultKey()).toEqual(G);
  expect(keychain.master_password).toBe(hex(G));
  expect(await getLocalSecret(MINE)).toBe("s3cret");
});

test("linking_a_grouped_password_vault_whose_move_fails_still_opens_and_settles_later", async () => {
  passwordDevice("pw");
  withData("mine", MINE);
  await joinGroup(grant, "combine");
  failing = (cmd) => cmd === "secrets_rekey";

  await linkToCloud("me@example.com", "https://sync.example.com");

  expect(disk.key).toEqual(G);
  expect(JSON.parse(keychain.wrapped_user_secrets!)).toMatchObject({ dek: DEK });
  expect(JSON.parse(keychain.wrapped_user_secrets_prior!)).toMatchObject({ kek: kekFor("pw"), dek: G });
  failing = null;
  relaunch();
  expect(await openWithStoredSecret("pw")).toBe("ok");
  expect(getVaultKey()).toEqual(G);
  expect(useVaultKeysStore.getState().dek).toEqual(DEK);
  expect(await getLocalSecret(MINE)).toBe("s3cret");

  await settleVaultOnDek();

  expect(disk.key).toEqual(DEK);
  expect(keychain.wrapped_user_secrets_prior).toBeUndefined();
  relaunch();
  expect(await openWithStoredSecret("pw")).toBe("ok");
  expect(getVaultKey()).toEqual(DEK);
});

test.each([false, true])("repair_after_forget_in_password_mode_killed_before_the_rekey_reopens (applied=%s)", async (applied) => {
  const G1 = bytes(150);
  passwordDevice("pw");
  leftGroupState("forgotten");
  withData("mine", MINE);
  disk.key = G1;
  setVaultKey(G1);
  keychain.wrapped_user_secrets = JSON.stringify({ kek: kekFor("pw"), dek: G1, x: [] });
  useVaultKeysStore.getState().set({ dek: G1, x25519Private: [], kek: kekFor("pw") });
  crash = { at: (cmd) => cmd === "secrets_rekey", applied };

  void joinGroup(grant, "combine", [HOST, hostPayload()]);
  await vi.waitFor(() => expect(crashed).not.toBeNull());
  expect(JSON.parse(keychain.wrapped_user_secrets!)).toMatchObject({ dek: G });

  relaunch();
  expect(await openWithStoredSecret("pw")).toBe("ok");
  const opened = applied ? G : G1;
  expect(getVaultKey()).toEqual(opened);
  expect(await getLocalSecret(MINE)).toBe("s3cret");
  expect(JSON.parse(keychain.wrapped_user_secrets!)).toMatchObject({ dek: opened });
  expect(keychain.wrapped_user_secrets_prior).toBeUndefined();
  relaunch();
  expect(await openWithStoredSecret("pw")).toBe("ok");
  expect(getVaultKey()).toEqual(opened);
});

test("password_join_failure_restores_the_prior_wrapped_key", async () => {
  const G1 = bytes(150);
  passwordDevice("pw");
  leftGroupState("forgotten");
  disk.key = G1;
  setVaultKey(G1);
  const prior = JSON.stringify({ kek: kekFor("pw"), dek: G1, x: [] });
  keychain.wrapped_user_secrets = prior;
  useVaultKeysStore.getState().set({ dek: G1, x25519Private: [], kek: kekFor("pw") });
  failing = (cmd) => cmd === "secrets_rekey";

  await expect(joinGroup(grant, "combine", [HOST, hostPayload()])).rejects.toThrow(/injected/);

  expect(keychain.wrapped_user_secrets).toBe(prior);
  expect(keychain.wrapped_user_secrets_prior).toBeUndefined();
  expect(disk.key).toEqual(G1);
});

test("grant_cuts_a_long_host_name_to_128_bytes_on_a_char_boundary", async () => {
  noPasswordDevice();
  const group = await createGroupIfNeeded();

  expect((await grantFor(group, "é".repeat(100))).hostName).toBe("é".repeat(64));
  expect((await grantFor(group, `a${"😀".repeat(40)}`)).hostName).toBe(`a${"😀".repeat(31)}`);
  expect((await grantFor(group, "Desktop")).hostName).toBe("Desktop");
});

function groupOne(self: Record<string, unknown>, others: Array<ReturnType<typeof entity> & { deleted_at?: string }> = []) {
  disk.files[LAN_GROUP_FILE] = JSON.stringify([
    entity("group", { kind: "group", group_id: "group-1" }),
    entity(SELF, { kind: "member", name: "laptop", platform: "linux", joined_at: OLD, ...self }),
    entity(HOST, { kind: "member", name: "Desktop", platform: "linux", device_key: HOST_KEY, joined_at: OLD }),
    ...others,
  ]);
}

test("rejoin_same_group_after_a_key_change_rewrites_self_with_the_new_key", async () => {
  noPasswordDevice(G);
  groupOne({ device_key: "ee".repeat(32) });
  expect((await readGroup())?.groupId).toBe("group-1");

  await joinGroup(grant, "combine");

  const self = (await readGroup())!.members.find((m) => m.id === SELF)!;
  expect(self.device_key).toBe(SELF_KEY);
  expect(isAlive(self)).toBe(true);
});

test("rejoin_same_group_after_being_forgotten_revives_self", async () => {
  noPasswordDevice(G);
  groupOne({ device_key: SELF_KEY });
  const host = hostPayload();
  const lan = JSON.parse(host.files[LAN_GROUP_FILE]);
  const me = entity(SELF, { kind: "member", name: "laptop", platform: "linux", device_key: SELF_KEY, joined_at: OLD });
  lan.push({ ...me, deleted_at: "2026-02-01T00:00:00.000Z", clocks: { ...me.clocks, __deleted__: "2026-02-01T00:00:00.000Z" } });
  host.files[LAN_GROUP_FILE] = JSON.stringify(lan);

  await joinGroup(grant, "combine", [HOST, host]);

  const merged = parseEntities(mergeBlobPayload(host, backend("state_export_raw") as BlobPayload).payload.files[LAN_GROUP_FILE]);
  expect(merged.filter(isAlive).map((e) => e.id).sort()).toEqual(["group", HOST, SELF]);
});

test("joining_with_a_key_an_old_member_still_holds_retires_that_member", async () => {
  noPasswordDevice();
  const host = hostPayload();
  const lan = JSON.parse(host.files[LAN_GROUP_FILE]);
  lan.push(entity("old-self", { kind: "member", name: "laptop", platform: "linux", device_key: SELF_KEY, joined_at: OLD }));
  host.files[LAN_GROUP_FILE] = JSON.stringify(lan);

  await joinGroup(grant, "combine", [HOST, host]);

  const group = (await readGroup())!;
  expect(group.members.filter(isAlive).map((m) => m.id).sort()).toEqual([HOST, SELF]);
  expect(await keyStillHeld("old-self")).toBe(true);
  expect(await keyStillHeld(HOST)).toBe(false);
  const onHost = parseEntities(mergeBlobPayload(host, backend("state_export_raw") as BlobPayload).payload.files[LAN_GROUP_FILE]);
  expect(onHost.filter(isAlive).map((e) => e.id).sort()).toEqual(["group", HOST, SELF]);
});

function holdEpochs(values: Record<number, string>) {
  for (const [epoch, secret] of Object.entries(values)) {
    disk.secrets[`lan-group-secret:${epoch}`] = secret;
    disk.clocks[`lan-group-secret:${epoch}`] = OLD;
  }
}

test.each([
  ["another vault key", K, { 1: "11".repeat(32) }],
  ["a disagreeing epoch secret", G, { 2: "33".repeat(32) }],
] as const)("rejoin_same_group_refuses_a_grant_with_%s", async (_case, vaultKey, held) => {
  noPasswordDevice(vaultKey);
  groupOne({ device_key: SELF_KEY });
  holdEpochs(held);

  await expect(joinGroup(grant, "combine")).rejects.toThrow(/lan group grant/);

  expect(calls("secrets_rekey")).toEqual([]);
  expect(getVaultKey()).toEqual(vaultKey);
  expect(disk.secrets).toMatchObject(Object.fromEntries(Object.entries(held).map(([e, v]) => [`lan-group-secret:${e}`, v])));
});

test("rejoin_same_group_keeps_held_epoch_secrets_at_their_own_clocks", async () => {
  noPasswordDevice(G);
  groupOne({ device_key: SELF_KEY });
  holdEpochs({ 1: "11".repeat(32) });

  await joinGroup(grant, "combine");

  expect(disk.clocks["lan-group-secret:1"]).toBe(OLD);
  expect(disk.secrets["lan-group-secret:2"]).toBe("22".repeat(32));
  expect(disk.clocks["lan-group-secret:2"]).not.toBe(OLD);
});

const tick = () => new Promise((r) => setTimeout(r, 5));
const groupSecretNames = () => Object.keys(disk.secrets).filter((n) => n.startsWith("lan-group-secret:"));
const exported = () => backend("state_export_raw") as BlobPayload;
const aliveIn = (payload: BlobPayload) => parseEntities(payload.files[LAN_GROUP_FILE]).filter(isAlive).map((e) => e.id).sort();

function hostThatListsMe(): BlobPayload {
  const host = hostPayload();
  const lan = JSON.parse(host.files[LAN_GROUP_FILE]);
  lan.push(entity(SELF, { kind: "member", name: "laptop", platform: "linux", device_key: SELF_KEY, joined_at: OLD }));
  host.files[LAN_GROUP_FILE] = JSON.stringify(lan);
  return host;
}

async function leftGroupOne(): Promise<BlobPayload> {
  noPasswordDevice(G);
  groupOne({ device_key: SELF_KEY });
  holdEpochs({ 1: "11".repeat(32), 2: "22".repeat(32) });
  await leaveGroup("left");
  const told = mergeBlobPayload(hostThatListsMe(), exported()).payload;
  await dropGroupSecrets();
  await tick();
  return told;
}

test("leaving_tells_the_group_then_keeps_no_group_secret_and_the_same_vault_key", async () => {
  noPasswordDevice(G);
  groupOne({ device_key: SELF_KEY });
  holdEpochs({ 1: "11".repeat(32), 2: "22".repeat(32) });

  await leaveGroup("left");
  const told = exported();
  expect(await holdsGroupSecrets()).toBe(true);
  await dropGroupSecrets();

  expect(await readGroup()).toBeNull();
  expect(groupSecretNames()).toEqual([]);
  expect(await holdsGroupSecrets()).toBe(false);
  expect(disk.clocks["lan-group-secret:2"]).toBe("2026-01-01T00:00:00.001Z");
  expect(getVaultKey()).toEqual(G);
  expect(disk.key).toEqual(G);
  expect(await pairInfo()).toMatchObject({ group: null, members: 0 });
  expect(await readFarewell()).toEqual({ secret: "22".repeat(32), reason: "left", group: "group-1", pending: [HOST] });
  expect(aliveIn(mergeBlobPayload(hostThatListsMe(), told).payload)).toEqual(["group", HOST]);
});

test("after_leaving_the_device_pairs_into_another_group", async () => {
  await leftGroupOne();
  const other: GroupGrant = { groupId: "group-2", vaultKey: hex(bytes(150)), secrets: [{ epoch: 1, secret: "33".repeat(32) }], hostName: "Phone" };

  await joinGroup(other, "combine");

  const group = (await readGroup())!;
  expect(group.groupId).toBe("group-2");
  expect(group.members.filter(isAlive).map((m) => m.id)).toEqual([SELF]);
  expect(group.secrets.map((s) => [s.epoch, hex(s.secret)])).toEqual([[1, "33".repeat(32)]]);
  expect(getVaultKey()).toEqual(bytes(150));
  expect(await readFarewell()).toBeNull();
});

test("after_leaving_the_device_pairs_back_into_the_same_group", async () => {
  const told = await leftGroupOne();
  expect(aliveIn(told)).toEqual(["group", HOST]);

  await joinGroup(grant, "combine");

  const group = (await readGroup())!;
  expect(group.groupId).toBe("group-1");
  expect(group.secrets.map((s) => [s.epoch, hex(s.secret)])).toEqual([[2, "22".repeat(32)], [1, "11".repeat(32)]]);
  const onHost = mergeBlobPayload(told, exported()).payload;
  expect(aliveIn(onHost)).toEqual(["group", HOST, SELF]);
  expect(onHost.secrets).toMatchObject({ "lan-group-secret:1": "11".repeat(32), "lan-group-secret:2": "22".repeat(32) });
});

test("a member that hears a device left retires only that live member", async () => {
  noPasswordDevice(G);
  const member = (id: string) => entity(id, { kind: "member", name: id, platform: "linux", device_key: HOST_KEY, joined_at: OLD });
  groupOne({ device_key: SELF_KEY }, [member("live"), { ...member("gone"), deleted_at: OLD }]);

  await markLeft("live");
  await markLeft("gone");
  await markLeft("stranger");
  await markLeft(SELF);

  const members = (await readGroup())!.members;
  expect(members.filter(isAlive).map((m) => m.id).sort()).toEqual([HOST, SELF]);
  expect(members.find((m) => m.id === "gone")!.updated_at).toBe(OLD);
  expect(members.some((m) => m.id === "stranger")).toBe(false);
});

test("a pairing names the member whose key it would replace", async () => {
  noPasswordDevice(G);
  const member = (id: string, name: string, key: string) => entity(id, { kind: "member", name, platform: "linux", device_key: key, joined_at: OLD });
  groupOne({ device_key: SELF_KEY }, [member("phone", "Old phone", "ef".repeat(32)), { ...member("tablet", "Tablet", "aa".repeat(32)), deleted_at: OLD }]);

  expect(await replacedMember("phone", "12".repeat(32))).toBe("Old phone");
  expect(await replacedMember("tablet", "12".repeat(32))).toBe("Tablet");
  expect(await replacedMember("tablet", "aa".repeat(32)), "a device that left or was forgotten, back with its own key").toBeUndefined();
  expect(await replacedMember("phone", "ef".repeat(32))).toBeUndefined();
  expect(await replacedMember(HOST, HOST_KEY)).toBeUndefined();
  expect(await replacedMember("stranger", "12".repeat(32))).toBeUndefined();
  disk.files[LAN_GROUP_FILE] = "[]";
  expect(await replacedMember("phone", "12".repeat(32))).toBeUndefined();
});

test("a leave owes each member a farewell before its tombstone is written, until each is told", async () => {
  noPasswordDevice(G);
  groupOne({ device_key: SELF_KEY }, [entity("phone", { kind: "member", name: "Phone", platform: "android", device_key: "ef".repeat(32), joined_at: OLD })]);
  holdEpochs({ 1: "11".repeat(32) });
  h.invoke.mockClear();

  await leaveGroup("left");

  const at = (match: (call: unknown[]) => boolean) => h.invoke.mock.invocationCallOrder[h.invoke.mock.calls.findIndex(match)];
  const owed = at(([cmd, args]) => cmd === "keychain_set" && (args as { key: string }).key === LAN_FAREWELL_ENTRY);
  expect(owed).toBeLessThan(at(([cmd]) => cmd === "state_import"));
  expect(aliveIn(exported())).toEqual(["group", HOST, "phone"]);
  expect((await readFarewell())?.pending).toEqual([HOST, "phone"]);
  await farewellSent("stranger");
  await Promise.all([farewellSent("phone"), farewellSent(HOST)]);
  expect(await readFarewell()).toMatchObject({ reason: "left", group: "group-1", pending: [] });
});

test("the last member to hear the farewell clears the left group's peer file, once", async () => {
  noPasswordDevice(G);
  groupOne({ device_key: SELF_KEY }, [entity("phone", { kind: "member", name: "Phone", platform: "android", device_key: "ef".repeat(32), joined_at: OLD })]);
  holdEpochs({ 1: "11".repeat(32) });
  await leaveGroup("left");

  await farewellSent("phone");
  expect(calls("lan_sync_clear_scope")).toEqual([]);
  await farewellSent(HOST);
  await farewellSent(HOST);
  expect(calls("lan_sync_clear_scope")).toEqual([{ scope: "group-1" }]);
});

test("an expired farewell for a left group clears that group's peer file; a moved one clears nothing", async () => {
  const kept = (reason: string) => JSON.stringify({ secret: "22".repeat(32), at: OLD, reason, group: "group-1", pending: [HOST] });
  keychain[LAN_FAREWELL_ENTRY] = kept("account");
  expect(await readFarewell()).toBeNull();
  expect(calls("lan_sync_clear_scope")).toEqual([]);

  keychain[LAN_FAREWELL_ENTRY] = kept("left");
  expect(await readFarewell()).toBeNull();
  expect(calls("lan_sync_clear_scope")).toEqual([{ scope: "group-1" }]);
});

test("joining a group clears the peer file of a group left earlier", async () => {
  await leftGroupOne();
  const other: GroupGrant = { groupId: "group-2", vaultKey: hex(bytes(150)), secrets: [{ epoch: 1, secret: "33".repeat(32) }], hostName: "Phone" };

  await joinGroup(other, "combine");

  expect(calls("lan_sync_clear_scope")).toEqual([{ scope: "group-1" }]);
});

test("a member that moved to an account is owed no farewell", async () => {
  noPasswordDevice(G);
  const phone = entity("phone", { kind: "member", name: "Phone", platform: "android", device_key: "ef".repeat(32), joined_at: OLD });
  groupOne({ device_key: SELF_KEY }, [{ ...phone, moved_at: OLD } as typeof phone]);
  holdEpochs({ 1: "11".repeat(32) });

  await leaveGroup("left");

  expect((await readFarewell())?.pending).toEqual([HOST]);
});
