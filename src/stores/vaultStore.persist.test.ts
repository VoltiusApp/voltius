// @vitest-environment jsdom
import { test, expect, vi } from "vitest";

vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));

import { useVaultStore } from "./vaultStore";

type Persisted = Parameters<NonNullable<ReturnType<typeof useVaultStore.persist.getOptions>["merge"]>>[0];

test("a personal vault turned into a team vault keeps its link across a reload", () => {
  const { partialize, merge } = useVaultStore.persist.getOptions();
  useVaultStore.getState().setVaultTeamId("personal", "t1");

  const saved = JSON.parse(JSON.stringify(partialize!(useVaultStore.getState()))) as Persisted;
  const restored = merge!(saved, { ...useVaultStore.getState(), vaults: [{ id: "personal", name: "Personal" }] });

  expect(restored.vaults.filter((v) => v.id === "personal")).toEqual([
    expect.objectContaining({ id: "personal", teamId: "t1" }),
  ]);
});

test("state saved before personal was persisted still restores the built-in personal vault first", () => {
  const { merge } = useVaultStore.persist.getOptions();
  const restored = merge!({ vaults: [{ id: "v1", name: "Prod" }], selectedVaultIds: ["personal"] } as Persisted, useVaultStore.getState());

  expect(restored.vaults.map((v) => v.id)).toEqual(["personal", "v1"]);
  expect(restored.vaults[0].teamId).toBeUndefined();
});

test("a fresh install with nothing stored restores the built-in defaults", () => {
  const { merge } = useVaultStore.persist.getOptions();
  const restored = merge!(undefined as unknown as Persisted, useVaultStore.getState());

  expect(restored.vaults.map((v) => v.id)).toEqual(["personal"]);
  expect(restored.deletedVaults).toEqual({});
  expect(restored.selectedVaultIds).toEqual(["personal"]);
});

test("a team vault's name is never written to disk and comes from the server", () => {
  const { partialize, merge } = useVaultStore.persist.getOptions();
  useVaultStore.setState({ vaults: [{ id: "personal", name: "Personal" }, { id: "v-team", name: "old local name", teamId: "t1" }] });

  const saved = JSON.parse(JSON.stringify(partialize!(useVaultStore.getState()))) as Persisted;
  expect(JSON.stringify(saved)).not.toContain("old local name");

  useVaultStore.setState(merge!(saved, useVaultStore.getState()));
  useVaultStore.getState().applyTeamNames({ t1: "Ops" });
  expect(useVaultStore.getState().vaults.find((v) => v.id === "v-team")?.name).toBe("Ops");
});

test("synced vault rows keep the server's team name", () => {
  useVaultStore.getState().applyTeamNames({ t1: "Ops" });
  useVaultStore.getState().applySyncedVaults({
    "v-team": { name: "stale name from another device", teamId: "t1", updatedAt: "2026-09-30T00:00:00.000Z" },
  });
  expect(useVaultStore.getState().vaults.find((v) => v.id === "v-team")?.name).toBe("Ops");
});
