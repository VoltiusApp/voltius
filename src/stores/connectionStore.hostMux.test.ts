// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";
import type { Connection } from "@/types";

vi.mock("@/services/teamObjectPersistence", () => ({
  saveTeamVaultObject: vi.fn(async () => {}),
  removeTeamVaultObject: vi.fn(async () => {}),
}));
vi.mock("@/services/connections", () => ({
  deleteConnection: vi.fn(async () => {}),
  listConnections: vi.fn(async () => []),
}));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));
vi.mock("@/services/account", () => ({ isServerMode: vi.fn(async () => false) }));
vi.mock("@/services/auditMutations", () => ({ reportAuditMutation: vi.fn() }));

import { useConnectionStore } from "./connectionStore";
import { useHostMuxStore } from "./hostMuxStore";

const conn = (id: string, vault_id?: string) =>
  ({ id, host: "h", port: 22, username: "u", auth_type: "password", tags: [], vault_id, created_at: "t0", updated_at: "t0" }) as unknown as Connection;

beforeEach(() => {
  useHostMuxStore.setState({ hosts: { c1: { kind: "tmux-cc", checkedAt: 1 }, c2: { kind: "screen", checkedAt: 1 } } });
});

test("deleting a host forgets its multiplexer", async () => {
  useConnectionStore.setState({ connections: [conn("c1"), conn("c2")], teamConnections: {} });
  await useConnectionStore.getState().deleteConnection("c1");
  expect(Object.keys(useHostMuxStore.getState().hosts)).toEqual(["c2"]);
});

test("deleting a team host forgets its multiplexer", async () => {
  useConnectionStore.setState({ connections: [], teamConnections: { t1: [conn("c2", "t1")] } });
  await useConnectionStore.getState().deleteConnection("c2");
  expect(Object.keys(useHostMuxStore.getState().hosts)).toEqual(["c1"]);
});
