import { test, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  listMembers: vi.fn(),
  unwrap: vi.fn(),
  getSecret: vi.fn(),
  storeSecret: vi.fn(),
  deleteSecret: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/teamService", () => ({ listMembers: h.listMembers }));
vi.mock("@/services/multiplayerService", () => ({
  unwrapSessionKey: h.unwrap,
  wrapSessionKeyForUser: vi.fn(),
  getMyX25519Keypair: vi.fn(),
}));
vi.mock("@/services/vault", () => ({
  getSecret: h.getSecret,
  storeSecret: h.storeSecret,
  deleteSecret: h.deleteSecret,
}));
vi.mock("@/services/teamObjects", () => ({ listTeamObjects: vi.fn(async () => []) }));

import { saveTeamData, fetchTeamData, clearTeamKeyCache } from "./teamVaultSync.ts";
import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { useTeamStore } from "@/stores/teamStore";

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
  h.listMembers.mockReset();
  h.unwrap.mockReset();
  h.getSecret.mockReset();
  h.storeSecret.mockReset();
  h.deleteSecret.mockReset();
  h.getSecret.mockResolvedValue(null);
  h.storeSecret.mockResolvedValue(undefined);
  h.deleteSecret.mockResolvedValue(undefined);
  clearTeamKeyCache();
});
afterEach(() => {
  clearTeamKeyCache();
});

test("saveTeamData encrypts the seven store slices and PUTs the blob", async () => {
  // getTeamVaultKey success path (unmocked real @/stores/* default to empty slices for a fresh teamId)
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/vault-key")) return res(200, { wrapped_key: "wk", wrapped_by_user_id: "u1" });
    if (url.endsWith("/sync-blob") && init?.method === "PUT") return res(200);
    throw new Error(`unexpected fetch ${url}`);
  });
  h.listMembers.mockResolvedValue([{ user_id: "u1", public_key: "pk" }]);
  h.unwrap.mockResolvedValue(new Uint8Array([9, 9, 9]));

  await saveTeamData("t-save-1");

  expect(h.invoke).toHaveBeenCalledWith(
    "encrypt_payload",
    expect.objectContaining({
      encKey: [9, 9, 9],
      files: {
        "connections.json": "[]",
        "identities.json": "[]",
        "ssh_keys.json": "[]",
        "folders.json": "[]",
        "snippets.json": "[]",
        "snippet_folders.json": "[]",
        "port_forwarding_rules.json": "[]",
      },
    }),
  );

  const putCall = h.appFetch.mock.calls.find(([url, init]) => url.endsWith("/sync-blob") && init?.method === "PUT");
  expect(putCall).toBeDefined();
  const [url, init] = putCall!;
  expect(url).toBe("https://s/v1/teams/t-save-1/sync-blob");
  const body = JSON.parse(init.body as string);
  expect(typeof body.blob).toBe("string");
});

/**
 * The blob is the fallback path, taken whenever the object route returns
 * nothing or fails. It collected a connection's password and key but not the
 * passphrase for that key, and an ssh key's private/public halves but not its
 * passphrase — so a member restored from a blob held material they could not
 * open.
 */
test("saveTeamData puts every secret an object owns into the blob, passphrases included", async () => {
  const teamId = "t-save-passphrase";
  useConnectionStore.getState().setTeamConnections(teamId, [{ id: "c1" }] as never);
  useKeyStore.getState().setTeamKeys(teamId, [{ id: "k1" }] as never);
  useIdentityStore.getState().setTeamIdentities(teamId, [{ id: "i1" }] as never);

  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.getSecret.mockImplementation(async (k: string) => `val-${k}`);
  h.appFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/vault-key")) return res(200, { wrapped_key: "wk", wrapped_by_user_id: "u1" });
    if (url.endsWith("/sync-blob") && init?.method === "PUT") return res(200);
    throw new Error(`unexpected fetch ${url}`);
  });
  h.listMembers.mockResolvedValue([{ user_id: "u1", public_key: "pk" }]);
  h.unwrap.mockResolvedValue(new Uint8Array([9, 9, 9]));

  await saveTeamData(teamId);

  const encryptCall = h.invoke.mock.calls.find(([cmd]) => cmd === "encrypt_payload");
  expect(Object.keys(encryptCall![1].secrets).sort()).toEqual(
    [
      "password:c1",
      "key:c1",
      "passphrase:c1",
      "key:k1:private",
      "key:k1:public",
      "key:k1:passphrase",
      "identity:i1:password",
    ].sort(),
  );
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
  h.listMembers.mockResolvedValue([{ user_id: "u1", public_key: "pk" }]);
  h.unwrap.mockResolvedValue(new Uint8Array([9, 9, 9]));

  await fetchTeamData(teamId);

  expect(h.deleteSecret.mock.calls.map((c) => c[0]).sort()).toEqual(
    [
      "password:c1",
      "key:c1",
      "passphrase:c1",
      "key:k1:private",
      "key:k1:public",
      "key:k1:passphrase",
      "identity:i1:password",
    ].sort(),
  );
});

test("saveTeamData throws when the PUT fails", async () => {
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/vault-key")) return res(200, { wrapped_key: "wk", wrapped_by_user_id: "u1" });
    if (url.endsWith("/sync-blob") && init?.method === "PUT") return res(500);
    throw new Error(`unexpected fetch ${url}`);
  });
  h.listMembers.mockResolvedValue([{ user_id: "u1", public_key: "pk" }]);
  h.unwrap.mockResolvedValue(new Uint8Array([9, 9, 9]));

  await expect(saveTeamData("t-save-2")).rejects.toThrow();
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
  h.listMembers.mockResolvedValue([{ user_id: "u1", public_key: "pk" }]);
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
