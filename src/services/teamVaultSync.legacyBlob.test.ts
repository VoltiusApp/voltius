import { test, expect, vi, beforeEach } from "vitest";

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
  publishMyPublicKey: vi.fn(),
}));
vi.mock("@/services/vault", () => ({
  getSecret: h.getSecret,
  storeSecret: h.storeSecret,
  deleteSecret: h.deleteSecret,
}));
vi.mock("@/services/teamObjects", () => ({ listTeamObjects: vi.fn(async () => []) }));

import { reencryptLegacyBlobIfStale, clearTeamKeyCache } from "./teamVaultSync.ts";

function futureJwt(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = btoa(JSON.stringify({ exp })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `h.${b64}.s`;
}
const keychain = (map: Record<string, string | null>) =>
  h.invoke.mockImplementation(async (cmd: string, args: { key: string }) => {
    if (cmd === "keychain_get") return map[args.key] ?? null;
    return null;
  });
const res = (status: number, body: unknown = {}) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: () => null } });
const methodOf = (init?: RequestInit) => init?.method ?? "GET";

beforeEach(() => {
  h.invoke.mockReset();
  h.appFetch.mockReset();
  h.listMembers.mockReset();
  h.unwrap.mockReset();
  h.getSecret.mockReset();
  h.storeSecret.mockReset();
  h.deleteSecret.mockReset();
  clearTeamKeyCache();
});

test("no legacy blob (404): does not PUT anything", async () => {
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/sync-blob")) return res(404);
    throw new Error(`unexpected fetch ${url}`);
  });

  await reencryptLegacyBlobIfStale("t1", 3, [9, 9, 9]);

  expect(h.appFetch).toHaveBeenCalledTimes(1);
  expect(h.appFetch.mock.calls.every(([, init]) => methodOf(init) === "GET")).toBe(true);
});

test("blob already at the current version: does not PUT anything", async () => {
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/sync-blob")) return res(200, { blob: btoa("x"), updated_at: "", key_version: 3 });
    throw new Error(`unexpected fetch ${url}`);
  });

  await reencryptLegacyBlobIfStale("t1", 3, [9, 9, 9]);

  expect(h.appFetch).toHaveBeenCalledTimes(1);
  expect(h.appFetch.mock.calls.every(([, init]) => methodOf(init) === "GET")).toBe(true);
});

test("blob behind the current version: decrypts with the OLD key, re-encrypts with the passed current key, and PUTs the passed current version", async () => {
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "keychain_get") return args.key === "server_url" ? "https://s" : futureJwt();
    if (cmd === "backup_decrypt") {
      const encKey = args.encKey as number[];
      if (encKey[0] !== 1) throw new Error("decrypted with the wrong (non-historical) key");
      return { files: { metadata: "old-file" }, secrets: { "password:c1": "hunter2" } };
    }
    if (cmd === "encrypt_payload") {
      const encKey = args.encKey as number[];
      if (encKey[0] !== 9) throw new Error("re-encrypted with the wrong (non-current) key");
      return [9, 9, 9];
    }
    return null;
  });
  h.appFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = methodOf(init);
    if (url.endsWith("/sync-blob") && method === "GET") {
      return res(200, { blob: btoa("old-blob-bytes"), updated_at: "", key_version: 1 });
    }
    if (url.endsWith("/vault-key/1") && method === "GET") {
      return res(200, { wrapped_key: "wk-old", wrapped_by_user_id: "u1", key_version: 1 });
    }
    if (url.endsWith("/sync-blob") && method === "PUT") {
      return res(200, {});
    }
    throw new Error(`unexpected fetch ${url} ${method}`);
  });
  h.listMembers.mockResolvedValue([{ user_id: "u1", public_key: "pk" }]);
  h.unwrap.mockResolvedValue(new Uint8Array([1])); // old epoch's raw key

  await reencryptLegacyBlobIfStale("t1", 3, [9, 9, 9]);

  // Went to the historical vault-key route for the blob's own (stale) epoch.
  expect(h.appFetch.mock.calls.some(([url, init]) => url.endsWith("/vault-key/1") && methodOf(init) === "GET")).toBe(true);

  const putCall = h.appFetch.mock.calls.find(([url, init]) => url.endsWith("/sync-blob") && methodOf(init) === "PUT");
  expect(putCall).toBeTruthy();
  const body = JSON.parse((putCall![1] as RequestInit).body as string);
  expect(body.key_version).toBe(3);
  expect(body.blob).toBe(btoa(String.fromCharCode(9, 9, 9)));
});
