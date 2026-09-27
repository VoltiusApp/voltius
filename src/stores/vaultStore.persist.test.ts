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
