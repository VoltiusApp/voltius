import { test, expect, beforeEach } from "vitest";
import { auditContextForVaultId } from "./auditContextResolver.ts";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";

beforeEach(() => {
  useTeamStore.setState({ teams: [] } as never);
  useVaultStore.setState({ vaults: [] } as never);
});

test("undefined/empty vaultId resolves to local 'personal'", () => {
  expect(auditContextForVaultId(undefined)).toEqual({ kind: "local", vaultId: "personal" });
  expect(auditContextForVaultId("")).toEqual({ kind: "local", vaultId: "personal" });
});

test("a vaultId that is itself a team id resolves to that team", () => {
  useTeamStore.setState({ teams: [{ id: "team-1", name: "Acme", role_ids: [] }] } as never);
  expect(auditContextForVaultId("team-1")).toEqual({ kind: "team", teamId: "team-1" });
});

test("a team-owned vault resolves to its owning team, carrying the vault id", () => {
  useVaultStore.setState({ vaults: [{ id: "v9", name: "Prod", teamId: "team-7" }] } as never);
  expect(auditContextForVaultId("v9")).toEqual({ kind: "team", teamId: "team-7", vaultId: "v9" });
});

test("a personal (non-team) vault resolves to local", () => {
  useVaultStore.setState({ vaults: [{ id: "v1", name: "Mine", teamId: null }] } as never);
  expect(auditContextForVaultId("v1")).toEqual({ kind: "local", vaultId: "v1" });
});

test("an unknown vault id resolves to local with that id", () => {
  expect(auditContextForVaultId("ghost")).toEqual({ kind: "local", vaultId: "ghost" });
});
