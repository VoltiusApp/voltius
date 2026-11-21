// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  listTeamObjects: vi.fn(),
  unwrap: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/teamObjects", () => ({ listTeamObjects: h.listTeamObjects }));
vi.mock("@/services/teamVaultSecrets", () => ({ hydrateTeamVaultSecrets: vi.fn(async () => {}) }));
vi.mock("@/services/teamObjectReencrypt", () => ({ runReencryptionPass: vi.fn(async () => 0) }));
vi.mock("@/services/secretRouting", () => ({ retryUnsentTeamSecrets: vi.fn(async () => {}) }));
vi.mock("@/services/vault", async (orig) => ({ ...(await orig<typeof import("@/services/vault")>()), purgeLocalSecrets: vi.fn(async () => {}) }));
vi.mock("@/services/teamService", async (orig) => ({
  ...(await orig<typeof import("@/services/teamService")>()),
  getUserPublicKey: vi.fn(async () => ({ user_id: "u1", handle: "u1", public_key: "pk" })),
}));
vi.mock("@/services/multiplayerService", () => ({
  unwrapSessionKey: h.unwrap,
  wrapSessionKeyForUser: vi.fn(),
  publishMyPublicKey: vi.fn(),
}));
vi.mock("@/services/teamObjectEnvelope", () => ({
  isEncryptedEnvelope: (m: unknown) => (m as { v?: number } | null)?.v === 2,
  decodeObjectMetadata: vi.fn(async (_teamId: string, m: { enc: string }) => {
    if (m.enc === "corrupt") throw new Error("aead tag mismatch");
    if (m.enc === "key-missing") throw "awaiting_key";
    return JSON.parse(m.enc);
  }),
}));

import { fetchTeamData, clearTeamKeyCache } from "./teamVaultSync";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useTeamStore } from "@/stores/teamStore";

function futureJwt(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = btoa(JSON.stringify({ exp })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `h.${b64}.s`;
}
const res = (status: number, body: unknown = {}) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: () => null } });

const row = (id: string, enc: string) => ({
  object_id: id,
  object_type: "connection" as const,
  metadata: { v: 2, enc },
  updated_by: "u1",
  updated_at: "2026-11-01T00:00:00.000Z",
  deleted_at: null,
});
const good = (id: string) => row(id, JSON.stringify({ id, name: id, host: `${id}.example`, port: 22, username: "root", tags: [] }));
const bad = (id: string) => row(id, "corrupt");

const status = () => useTeamVaultStateStore.getState().statusByTeamId.t1;
const undecryptable = () => useTeamVaultStateStore.getState().undecryptableByTeamId.t1 ?? {};
const hostIds = () => (useConnectionStore.getState().teamConnections.t1 ?? []).map((c) => c.id);

function keyResponds(code: number) {
  h.appFetch.mockImplementation(async () => res(code, { wrapped_key: "wk", wrapped_by_user_id: "u1", key_version: 1 }));
}

beforeEach(() => {
  h.invoke.mockReset().mockImplementation(async (cmd: string, args: { key: string }) =>
    cmd === "keychain_get" ? ({ server_url: "https://s", jwt: futureJwt() } as Record<string, string>)[args.key] ?? null : null);
  h.unwrap.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
  h.listTeamObjects.mockReset();
  keyResponds(200);
  useTeamVaultStateStore.getState().clearAll();
  useConnectionStore.setState({ teamConnections: {} });
  clearTeamKeyCache();
  localStorage.clear();
});

test("a vault whose every row fails to decrypt is not reported as loaded and empty", async () => {
  h.listTeamObjects.mockResolvedValue([bad("c1"), bad("c2")]);

  await fetchTeamData("t1");

  expect(status()).toBe("undecryptable");
  expect(hostIds()).toEqual([]);
  expect(undecryptable()).toEqual({ decrypt: 2 });
});

test("rows that fail because the key is missing report the key state", async () => {
  h.listTeamObjects.mockResolvedValue([bad("c1")]);
  keyResponds(404);

  await fetchTeamData("t1");

  expect(status()).toBe("awaiting_key");
});

test("a key 403 for a member still listed in the team is not shown as a revocation", async () => {
  useTeamStore.setState({ teams: [{ id: "t1", name: "Ops", role_ids: [], owner_tier: "business" }] as never, rolesByTeam: { t1: [] } });
  h.listTeamObjects.mockResolvedValue([bad("c1")]);
  keyResponds(403);

  await fetchTeamData("t1");

  expect(status()).toBe("undecryptable");
});

test("a partial failure keeps the readable rows and counts the rest", async () => {
  h.listTeamObjects.mockResolvedValue([good("c1"), bad("c2"), bad("c3")]);

  await fetchTeamData("t1");

  expect(status()).toBe("loaded");
  expect(hostIds()).toEqual(["c1"]);
  expect(undecryptable()).toEqual({ decrypt: 2 });
});

test("an empty vault loads without a decryption warning", async () => {
  h.listTeamObjects.mockResolvedValue([]);
  h.appFetch.mockImplementation(async (url: string) =>
    res(url.endsWith("/sync-blob") ? 404 : 200, { wrapped_key: "wk", wrapped_by_user_id: "u1", key_version: 1 }));

  await fetchTeamData("t1");

  expect(status()).toBe("loaded");
  expect(undecryptable()).toEqual({});
});

test("a background refresh that decrypts nothing keeps the vault it already showed", async () => {
  h.listTeamObjects.mockResolvedValue([good("c1")]);
  await fetchTeamData("t1");

  h.listTeamObjects.mockResolvedValue([bad("c1")]);
  await fetchTeamData("t1", { background: true });

  expect(status()).toBe("loaded");
  expect(hostIds()).toEqual(["c1"]);
});

test("once the rows decrypt again the warning clears and they come back", async () => {
  h.listTeamObjects.mockResolvedValue([good("c1"), bad("c2")]);
  await fetchTeamData("t1");
  expect(undecryptable()).toEqual({ decrypt: 1 });

  h.listTeamObjects.mockResolvedValue([good("c1"), good("c2")]);
  await fetchTeamData("t1");

  expect(undecryptable()).toEqual({});
  expect(hostIds().sort()).toEqual(["c1", "c2"]);
});

test("each hidden row is counted under the reason it failed", async () => {
  h.listTeamObjects.mockResolvedValue([
    good("c1"),
    bad("c2"),
    row("c3", "key-missing"),
    row("c4", JSON.stringify({ id: "c1", host: "moved.example" })),
    { ...good("c5"), metadata: { id: "c5", host: "plain.example" } },
  ]);
  localStorage.setItem("voltius.team_objects_encrypted_only", JSON.stringify(["t1"]));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  await fetchTeamData("t1");

  expect(status()).toBe("loaded");
  expect(hostIds()).toEqual(["c1"]);
  expect(undecryptable()).toEqual({ decrypt: 1, key: 1, mismatch: 1, untrusted: 1 });
  const logged = warn.mock.calls.flat().join(" ");
  expect(logged).toContain("object=c4 reason=mismatch");
  expect(logged).not.toContain("moved.example");
  expect(logged).not.toContain("plain.example");
  warn.mockRestore();
});
