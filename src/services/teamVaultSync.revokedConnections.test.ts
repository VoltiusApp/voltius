// @vitest-environment jsdom
import { test, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === "keychain_get" ? "https://mock.example" : null)),
}));

const h = vi.hoisted(() => ({ list: async (): Promise<unknown[]> => [] }));
vi.mock("@/services/teamObjects", async (orig) => ({
  ...(await orig<typeof import("@/services/teamObjects")>()),
  listTeamObjects: vi.fn(() => h.list()),
}));
vi.mock("@/services/authFetch", () => ({
  fetchAuthRateLimited: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
  fetchWithAuth: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("@/services/teamVaultSecrets", () => ({ hydrateTeamVaultSecrets: vi.fn(async () => {}) }));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: { getState: () => ({ teams: [{ id: "t1" }], rolesByTeam: { t1: [] } }) },
}));

import { fetchTeamData, clearTeamKeyCache } from "./teamVaultSync";
import { onConnectionsRevoked } from "./connectionRevocations";
import { PERM_BITS } from "./permissions";
import { useConnectionStore } from "@/stores/connectionStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import type { Connection } from "@/types";

const VIEW_CONNECT = PERM_BITS.VIEW | PERM_BITS.CONNECT;
const host = (id: string) => ({ id, name: id, host: `${id}.example`, vault_id: "t1" }) as unknown as Connection;
const row = (id: string, myPermissions = VIEW_CONNECT) => ({
  object_id: id,
  object_type: "connection",
  metadata: { id, name: id, host: `${id}.example` },
  updated_at: "2026-11-15T00:00:00.000Z",
  updated_by: "u1",
  my_permissions: myPermissions,
});

let revoked: string[][];
let stop: () => void;

beforeEach(() => {
  clearTeamKeyCache();
  localStorage.clear();
  revoked = [];
  stop = onConnectionsRevoked((ids) => revoked.push([...ids].sort()));
  useConnectionStore.setState({ connections: [], teamConnections: { t1: [host("c1"), host("c2")] } });
  useTeamVaultStateStore.setState({ statusByTeamId: { t1: "loaded" }, errorByTeamId: {} });
});

afterEach(() => stop());

test("a host the server stops listing is revoked", async () => {
  h.list = async () => [row("c1")];
  await fetchTeamData("t1");
  expect(revoked).toEqual([["c2"]]);
});

test("a host still listed without Connect is revoked", async () => {
  h.list = async () => [row("c1"), row("c2", PERM_BITS.VIEW)];
  await fetchTeamData("t1");
  expect(revoked).toEqual([["c2"]]);
});

test("a refresh that keeps every host connectable revokes nothing", async () => {
  h.list = async () => [row("c1"), row("c2")];
  await fetchTeamData("t1");
  expect(revoked).toEqual([]);
});

test("a server error that empties the stores revokes nothing", async () => {
  h.list = async () => {
    throw Object.assign(new Error("boom"), { status: 500 });
  };
  await fetchTeamData("t1");
  expect(useTeamVaultStateStore.getState().statusByTeamId.t1).toBe("error");
  expect(revoked).toEqual([]);
});

test("losing the vault outright revokes every host in it", async () => {
  h.list = async () => {
    throw Object.assign(new Error("gone"), { status: 403 });
  };
  await fetchTeamData("t1");
  expect(useTeamVaultStateStore.getState().statusByTeamId.t1).toBe("forbidden");
  expect(revoked).toEqual([["c1", "c2"]]);
});

test("a host that moved to another team the user can still reach is not revoked", async () => {
  useConnectionStore.setState({ teamConnections: { t1: [host("c1"), host("c2")], t2: [host("c2")] } });
  h.list = async () => [row("c1")];
  await fetchTeamData("t1");
  expect(revoked).toEqual([]);
});

test("a host that moved to the user's personal vault is not revoked", async () => {
  useConnectionStore.setState({ connections: [{ ...host("c2"), vault_id: "personal" }] });
  h.list = async () => [row("c1")];
  await fetchTeamData("t1");
  expect(revoked).toEqual([]);
});

test("a local copy still tagged with the lost team does not keep the host open", async () => {
  useConnectionStore.setState({ connections: [host("c2")] });
  h.list = async () => [row("c1")];
  await fetchTeamData("t1");
  expect(revoked).toEqual([["c2"]]);
});

test("a listed host this device fails to decode is not revoked", async () => {
  h.list = async () => [row("c1"), { ...row("c2"), metadata: { id: "someone-else", host: "x" } }];
  await fetchTeamData("t1");
  expect(revoked).toEqual([]);
});

test("a realtime change to the team's permissions closes a host that lost Connect", async () => {
  const { handleRealtimeEvent } = await import("./sync");
  h.list = async () => [row("c1"), row("c2", PERM_BITS.VIEW)];
  await handleRealtimeEvent("team:t1", "device-1");
  await vi.waitFor(() => expect(revoked).toEqual([["c2"]]));
});
