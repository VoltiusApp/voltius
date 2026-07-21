import { test, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn(), listMembers: vi.fn(), unwrap: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/teamService", () => ({ listMembers: h.listMembers }));
vi.mock("@/services/multiplayerService", () => ({
  unwrapSessionKey: h.unwrap,
  wrapSessionKeyForUser: vi.fn(),
  getMyX25519Keypair: vi.fn(),
}));
vi.mock("@/services/vault", () => ({
  getSecret: vi.fn(async () => null),
  storeSecret: vi.fn(async () => {}),
  deleteSecret: vi.fn(async () => {}),
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
