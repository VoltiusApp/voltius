import { describe, test, expect } from "vitest";
import { deriveAccessibleVaultIds, deriveScopedVaultId, deriveOrphanVaultIds } from "./accessibleVaults";
import type { Vault } from "@/stores/vaultStore";
import type { Team } from "@/stores/teamStore";

const team = (id: string): Team => ({ id }) as Team;
const localVault = (id: string): Vault => ({ id, name: id });
const teamVault = (id: string, teamId: string): Vault => ({ id, name: id, teamId });

test("'personal' is always passed through, even with no vaults or teams", () => {
  expect(
    deriveAccessibleVaultIds({ selectedVaultIds: ["personal"], vaults: [], teams: [], cloudActive: false }),
  ).toEqual(["personal"]);
});

test("a local (non-team) vault is accessible regardless of cloud connectivity", () => {
  const vaults = [localVault("v1")];
  expect(
    deriveAccessibleVaultIds({ selectedVaultIds: ["v1"], vaults, teams: [], cloudActive: false }),
  ).toEqual(["v1"]);
  expect(
    deriveAccessibleVaultIds({ selectedVaultIds: ["v1"], vaults, teams: [], cloudActive: true }),
  ).toEqual(["v1"]);
});

test("a team vault while cloud-active yields BOTH the vault id and its team id", () => {
  expect(
    deriveAccessibleVaultIds({
      selectedVaultIds: ["v1"],
      vaults: [teamVault("v1", "t1")],
      teams: [],
      cloudActive: true,
    }),
  ).toEqual(["v1", "t1"]);
});

test("a team vault while offline is accessible only if its team is already loaded (and then also emits the team id)", () => {
  const vaults = [teamVault("v1", "t1")];
  expect(
    deriveAccessibleVaultIds({ selectedVaultIds: ["v1"], vaults, teams: [team("t1")], cloudActive: false }),
  ).toEqual(["v1", "t1"]);
});

test("a team vault while offline with its team NOT loaded is excluded entirely (no vault id, no team id)", () => {
  expect(
    deriveAccessibleVaultIds({
      selectedVaultIds: ["v1"],
      vaults: [teamVault("v1", "t1")],
      teams: [],
      cloudActive: false,
    }),
  ).toEqual([]);
});

test("an unknown id that is neither a vault nor a loaded team is dropped", () => {
  expect(
    deriveAccessibleVaultIds({ selectedVaultIds: ["ghost"], vaults: [], teams: [], cloudActive: true }),
  ).toEqual([]);
});

test("an unknown id is kept once it is known to be an orphan vault", () => {
  expect(
    deriveAccessibleVaultIds({
      selectedVaultIds: ["ghost"],
      vaults: [],
      teams: [],
      cloudActive: true,
      orphanVaultIds: ["ghost"],
    }),
  ).toEqual(["ghost"]);
});

test("an orphan id keeps its place among the vaults around it", () => {
  expect(
    deriveAccessibleVaultIds({
      selectedVaultIds: ["personal", "ghost", "v1"],
      vaults: [localVault("v1")],
      teams: [],
      cloudActive: true,
      orphanVaultIds: ["ghost"],
    }),
  ).toEqual(["personal", "ghost", "v1"]);
});

describe("deriveOrphanVaultIds", () => {
  const input = (objectVaultIds: (string | undefined)[], vaults: Vault[] = [], teams: Team[] = []) =>
    deriveOrphanVaultIds({ objectVaultIds, vaults, teams });

  test("a vault id carried by an object but held by no local vault is an orphan", () => {
    expect(input(["ghost"])).toEqual(["ghost"]);
  });

  test("personal, known vaults, their team ids, and loaded teams are all not orphans", () => {
    expect(
      input(
        ["personal", "v1", "t1", "t2", undefined],
        [localVault("v1"), teamVault("v2", "t1")],
        [team("t2")],
      ),
    ).toEqual([]);
  });

  test("repeated ids collapse to one, in a stable order", () => {
    expect(input(["b", "a", "b"])).toEqual(["a", "b"]);
  });
});

test("a standalone server team UUID (not backed by a local vault) is kept when the team is loaded", () => {
  expect(
    deriveAccessibleVaultIds({ selectedVaultIds: ["t1"], vaults: [], teams: [team("t1")], cloudActive: false }),
  ).toEqual(["t1"]);
});

test("a standalone server team UUID is dropped when the team is not loaded, even while cloud-active", () => {
  expect(
    deriveAccessibleVaultIds({ selectedVaultIds: ["t1"], vaults: [], teams: [], cloudActive: true }),
  ).toEqual([]);
});

test("input order is preserved across a mix of personal, local, and team-vault ids", () => {
  const vaults = [localVault("v1"), teamVault("v2", "t2")];
  expect(
    deriveAccessibleVaultIds({
      selectedVaultIds: ["personal", "v1", "v2"],
      vaults,
      teams: [],
      cloudActive: true,
    }),
  ).toEqual(["personal", "v1", "v2", "t2"]);
});

test("no de-duplication: the same team id backing two selected vaults is emitted twice", () => {
  const vaults = [teamVault("v1", "shared"), teamVault("v2", "shared")];
  expect(
    deriveAccessibleVaultIds({
      selectedVaultIds: ["v1", "v2"],
      vaults,
      teams: [],
      cloudActive: true,
    }),
  ).toEqual(["v1", "shared", "v2", "shared"]);
});

test("deriveScopedVaultId names the vault when exactly one is on screen", () => {
  expect(
    deriveScopedVaultId({
      selectedVaultIds: ["personal"],
      vaults: [],
      accessibleVaultIds: ["personal"],
    }),
  ).toBe("personal");
});

// A selected team vault yields two accessible ids (vault + team). The one objects
// carry is the team id, so that is the destination a paste must name.
test("deriveScopedVaultId returns the team id for a linked team vault", () => {
  expect(
    deriveScopedVaultId({
      selectedVaultIds: ["v1"],
      vaults: [teamVault("v1", "t1")],
      accessibleVaultIds: ["v1", "t1"],
    }),
  ).toBe("t1");
});

test("deriveScopedVaultId is null with several vaults on screen", () => {
  expect(
    deriveScopedVaultId({
      selectedVaultIds: ["personal", "v1"],
      vaults: [localVault("v1")],
      accessibleVaultIds: ["personal", "v1"],
    }),
  ).toBeNull();
});

test("deriveScopedVaultId is null when the selected vault is unreachable", () => {
  expect(
    deriveScopedVaultId({
      selectedVaultIds: ["v1"],
      vaults: [teamVault("v1", "t1")],
      accessibleVaultIds: [],
    }),
  ).toBeNull();
});
