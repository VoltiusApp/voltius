import { test, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  getUserPublicKey: vi.fn(),
  listRoles: vi.fn(),
  unwrap: vi.fn(),
  getSecret: vi.fn(),
  storeSecret: vi.fn(),
  purge: vi.fn(),
  getLocalSecret: vi.fn(async (_key: string) => null as string | null),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/teamService", () => ({ getUserPublicKey: h.getUserPublicKey, listRoles: h.listRoles }));
vi.mock("@/services/multiplayerService", () => ({
  unwrapSessionKey: h.unwrap,
  wrapSessionKeyForUser: vi.fn(),
  publishMyPublicKey: vi.fn(),
}));
vi.mock("@/services/vault", () => ({
  getSecret: h.getSecret,
  storeSecret: h.storeSecret,
  purgeLocalSecrets: h.purge,
  getLocalSecret: h.getLocalSecret,
}));
vi.mock("@/services/teamObjects", () => ({ listTeamObjects: vi.fn(async () => []) }));

import { fetchTeamData, clearTeamKeyCache } from "./teamVaultSync.ts";
import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { useTeamStore } from "@/stores/teamStore";
import { listTeamObjects } from "@/services/teamObjects";
import { teamSecretCache } from "./teamSecretCache";
import { PERM_BITS } from "@/services/permissions";

function futureJwt(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = btoa(JSON.stringify({ exp })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `h.${b64}.s`;
}
const keychain = (map: Record<string, string | null>) =>
  h.invoke.mockImplementation(async (cmd: string, args: { key: string }) => {
    if (cmd === "keychain_get") return map[args.key] ?? null;
    if (cmd === "encrypt_payload") return [1, 2, 3];
    return null;
  });

const res = (status: number, body: unknown = {}) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: () => null } });

beforeEach(() => {
  h.invoke.mockReset();
  h.appFetch.mockReset();
  h.getUserPublicKey.mockReset();
  h.listRoles.mockReset();
  h.unwrap.mockReset();
  h.getSecret.mockReset();
  h.storeSecret.mockReset();
  h.purge.mockReset();
  h.getSecret.mockResolvedValue(null);
  h.storeSecret.mockResolvedValue(undefined);
  h.purge.mockImplementation(async (keys: string[]) => keys);
  clearTeamKeyCache();
});
afterEach(() => {
  clearTeamKeyCache();
});

/**
 * Clearing a team vault wipes its secrets from disk first, while the ids are
 * still in memory. It skipped both passphrase shapes, so they outlived the
 * vault they belonged to.
 */
test("clearing a team vault deletes every secret it owns, passphrases included", async () => {
  const teamId = "t-clear-passphrase";
  useConnectionStore.getState().setTeamConnections(teamId, [{ id: "c1" }] as never);
  useKeyStore.getState().setTeamKeys(teamId, [{ id: "k1" }] as never);
  useIdentityStore.getState().setTeamIdentities(teamId, [{ id: "i1" }] as never);

  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/vault-key")) return res(200, { wrapped_key: "wk", wrapped_by_user_id: "u1" });
    // No blob yet — the path that clears the vault to show it as empty.
    if (url.endsWith("/sync-blob")) return res(404);
    throw new Error(`unexpected fetch ${url}`);
  });
  h.getUserPublicKey.mockResolvedValue({ user_id: "u1", handle: "u1", public_key: "pk" });
  h.unwrap.mockResolvedValue(new Uint8Array([9, 9, 9]));

  await fetchTeamData(teamId);

  expect(h.purge).toHaveBeenCalledTimes(1);
  expect(h.purge.mock.calls[0][0].sort()).toEqual(
    [
      "password:c1",
      "key:c1",
      "passphrase:c1",
      "proxy_password:c1",
      "key:k1:private",
      "key:k1:public",
      "key:k1:passphrase",
      "identity:i1:password",
    ].sort(),
  );
});

test("fetchTeamData decrypts the legacy blob and populates the seven store slices", async () => {
  const teamId = "t-fetch-1";
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "keychain_get") return args.key === "server_url" ? "https://s" : futureJwt();
    if (cmd === "backup_decrypt") {
      return {
        files: {
          "connections.json": JSON.stringify([{ id: "c1" }]),
          "identities.json": JSON.stringify([{ id: "i1" }]),
          "ssh_keys.json": JSON.stringify([{ id: "k1" }]),
          "folders.json": JSON.stringify([{ id: "f1" }]),
          "snippets.json": JSON.stringify([{ id: "sn1" }]),
          "snippet_folders.json": JSON.stringify([{ id: "sf1" }]),
          "port_forwarding_rules.json": JSON.stringify([{ id: "pf1" }]),
        },
        secrets: {},
      };
    }
    return null;
  });
  h.appFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/vault-key")) return res(200, { wrapped_key: "wk", wrapped_by_user_id: "u1" });
    if (url.endsWith("/sync-blob")) return res(200, { blob: btoa("ignored-bytes"), updated_at: "" });
    throw new Error(`unexpected fetch ${url}`);
  });
  h.getUserPublicKey.mockResolvedValue({ user_id: "u1", handle: "u1", public_key: "pk" });
  h.unwrap.mockResolvedValue(new Uint8Array([9, 9, 9]));

  await fetchTeamData(teamId);

  expect(useConnectionStore.getState().teamConnections[teamId]).toEqual([{ id: "c1" }]);
  expect(useIdentityStore.getState().teamIdentities[teamId]).toEqual([{ id: "i1" }]);
  expect(useKeyStore.getState().teamKeys[teamId]).toEqual([{ id: "k1" }]);
  expect(useFolderStore.getState().teamFolders[teamId]).toEqual([{ id: "f1" }]);
  expect(useSnippetStore.getState().teamSnippets[teamId]).toMatchObject([{ id: "sn1" }]);
  expect(useSnippetFolderStore.getState().teamSnippetFolders[teamId]).toEqual([{ id: "sf1" }]);
  expect(usePortForwardingStore.getState().teamRules[teamId]).toEqual([{ id: "pf1" }]);
  expect(useTeamVaultStateStore.getState().statusByTeamId[teamId]).toBe("loaded");
});

/**
 * The legacy blob route gains `key_version` alongside the object routes (#217).
 * A blob written before the team's most recent rotation must be decrypted with
 * the epoch it was actually encrypted under, not the current one.
 */
test("fetchTeamData decrypts the legacy blob with the historical key when its key_version is behind the team's current epoch", async () => {
  const teamId = "t-fetch-rotated";
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "keychain_get") return args.key === "server_url" ? "https://s" : futureJwt();
    if (cmd === "backup_decrypt") {
      const encKey = args.encKey as number[];
      if (encKey[0] !== 1) throw new Error("decrypted with the wrong epoch's key");
      return { files: { "connections.json": JSON.stringify([{ id: "c1" }]) }, secrets: {} };
    }
    return null;
  });
  h.appFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/vault-key")) return res(200, { wrapped_key: "wk-current", wrapped_by_user_id: "u1", key_version: 3 });
    if (url.endsWith("/vault-key/1")) return res(200, { wrapped_key: "wk-old", wrapped_by_user_id: "u1", key_version: 1 });
    if (url.endsWith("/sync-blob")) return res(200, { blob: btoa("ignored-bytes"), updated_at: "", key_version: 1 });
    throw new Error(`unexpected fetch ${url}`);
  });
  h.getUserPublicKey.mockResolvedValue({ user_id: "u1", handle: "u1", public_key: "pk" });
  h.unwrap.mockImplementation(async (wrappedKey: string) =>
    wrappedKey === "wk-old" ? new Uint8Array([1]) : new Uint8Array([9, 9, 9]),
  );

  await fetchTeamData(teamId);

  expect(useConnectionStore.getState().teamConnections[teamId]).toEqual([{ id: "c1" }]);
  expect(useTeamVaultStateStore.getState().statusByTeamId[teamId]).toBe("loaded");
});

/**
 * connect-only members hold no VIEW_SECRETS, so `GET /vault-key` 403s for them.
 * On an empty team vault — the one a joiner meets right after conversion — that
 * used to surface as "Access revoked" (issue #187). They were never revoked:
 * their view of the vault is the object route, which returned nothing.
 */
test("fetchTeamData shows an empty vault, not a revocation, when the key route 403s a listed member", async () => {
  const teamId = "t-connect-only";
  useTeamStore.setState({ teams: [{ id: teamId, role_ids: [] }] as never });
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/vault-key")) return res(403);
    throw new Error(`unexpected fetch ${url}`);
  });

  await fetchTeamData(teamId);

  expect(useTeamVaultStateStore.getState().statusByTeamId[teamId]).toBe("loaded");
  expect(useConnectionStore.getState().teamConnections[teamId] ?? []).toEqual([]);
});

test.each([
  ["lost Connect to the lapse", "plan_lapsed", { role_ids: [], permission_allow: PERM_BITS.VIEW | PERM_BITS.CONNECT }],
  ["never had Connect from Business", "loaded", { role_ids: ["b"], permission_deny: PERM_BITS.CONNECT }],
])("a listed member on a locked team who %s gets %s on a key-route 403", async (_why, expected, masks) => {
  const teamId = `t-lapse-${expected}`;
  const builtin = { id: "b", team_id: teamId, name: "member", permissions: PERM_BITS.VIEW | PERM_BITS.CONNECT, is_builtin: true, position: 3, created_at: "" };
  useTeamStore.setState({
    teams: [{ id: teamId, owner_tier: "teams", ...masks }] as never,
    rolesByTeam: { [teamId]: [builtin] },
  });
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/vault-key")) return res(403);
    throw new Error(`unexpected fetch ${url}`);
  });

  await fetchTeamData(teamId);

  expect(useTeamVaultStateStore.getState().statusByTeamId[teamId]).toBe(expected);
});

test.each([
  ["fetches them and reports the lapse", "plan_lapsed", async () => [{ id: "c", team_id: "t", name: "ops", permissions: PERM_BITS.VIEW | PERM_BITS.CONNECT, is_builtin: false, position: 5, created_at: "" }]],
  ["falls back to loaded when the fetch fails", "loaded", async () => { throw new Error("offline"); }],
])("a lapsed member whose roles are not cached yet %s", async (_why, expected, listRoles) => {
  const teamId = `t-roles-${expected}`;
  h.listRoles.mockImplementation(listRoles);
  const { [teamId]: _drop, ...rolesByTeam } = useTeamStore.getState().rolesByTeam;
  useTeamStore.setState({ teams: [{ id: teamId, owner_tier: "teams", role_ids: ["c"] }] as never, rolesByTeam });
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/vault-key")) return res(403);
    throw new Error(`unexpected fetch ${url}`);
  });

  await fetchTeamData(teamId);

  expect(h.listRoles).toHaveBeenCalledWith(teamId);
  expect(useTeamVaultStateStore.getState().statusByTeamId[teamId]).toBe(expected);
});

test("fetchTeamData still reports a revocation when the 403'd team is no longer listed", async () => {
  const teamId = "t-revoked";
  useTeamStore.setState({ teams: [] as never });
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/vault-key")) return res(403);
    throw new Error(`unexpected fetch ${url}`);
  });

  await fetchTeamData(teamId);

  expect(useTeamVaultStateStore.getState().statusByTeamId[teamId]).toBe("forbidden");
});

function blob404(): void {
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/vault-key")) return res(200, { wrapped_key: "wk", wrapped_by_user_id: "u1" });
    if (url.endsWith("/sync-blob")) return res(404);
    throw new Error(`unexpected fetch ${url}`);
  });
  h.getUserPublicKey.mockResolvedValue({ user_id: "u1", handle: "u1", public_key: "pk" });
  h.unwrap.mockResolvedValue(new Uint8Array([9, 9, 9]));
}

test("a failed object list followed by a missing legacy blob is an error, not an empty vault", async () => {
  blob404();
  vi.mocked(listTeamObjects).mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 500 }));

  await fetchTeamData("t-list-500");

  expect(useTeamVaultStateStore.getState().statusByTeamId["t-list-500"]).toBe("error");
});

test("a team whose object list is genuinely empty and has no blob loads as empty", async () => {
  blob404();
  vi.mocked(listTeamObjects).mockResolvedValueOnce([]);

  await fetchTeamData("t-empty");

  expect(useTeamVaultStateStore.getState().statusByTeamId["t-empty"]).toBe("loaded");
});

function staleTeam(teamId: string, blobStatus: number, keyStatus = 200): void {
  useTeamStore.setState({ teams: [{ id: teamId, role_ids: [] }] as never });
  useConnectionStore.getState().setTeamConnections(teamId, [{ id: "stale" }] as never);
  useFolderStore.getState().setTeamFolders(teamId, [{ id: "stale-folder" }] as never);
  teamSecretCache.set(teamId, "password:stale", "pw");
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/vault-key")) return keyStatus === 200 ? res(200, { wrapped_key: "wk", wrapped_by_user_id: "u1" }) : res(keyStatus);
    if (url.endsWith("/sync-blob")) return res(blobStatus);
    throw new Error(`unexpected fetch ${url}`);
  });
  h.getUserPublicKey.mockResolvedValue({ user_id: "u1", handle: "u1", public_key: "pk" });
  h.unwrap.mockResolvedValue(new Uint8Array([9, 9, 9]));
  vi.mocked(listTeamObjects).mockResolvedValueOnce([]);
}

const expectEmptied = (teamId: string) => {
  expect(useConnectionStore.getState().teamConnections[teamId] ?? []).toEqual([]);
  expect(useFolderStore.getState().teamFolders[teamId] ?? []).toEqual([]);
  expect(teamSecretCache.entries(teamId).size).toBe(0);
};

test.each([
  ["the legacy blob is forbidden", "t-bg-403", 403, 200],
  ["there is no legacy blob", "t-bg-404", 404, 200],
  ["the key route 403s a listed member", "t-bg-key-403", 404, 403],
])("a background refetch whose object list is empty clears the team when %s", async (_, teamId, blobStatus, keyStatus) => {
  staleTeam(teamId, blobStatus, keyStatus);

  await fetchTeamData(teamId, { background: true });

  expectEmptied(teamId);
});
