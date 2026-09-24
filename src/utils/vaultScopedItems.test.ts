import { test, expect } from "vitest";
import { selectVaultScopedItems } from "./vaultScopedItems";

test("a personal vault turned into a team vault offers its team items", () => {
  const items = selectVaultScopedItems({
    vaultId: "personal",
    localItems: [{ vault_id: "personal" }],
    teamItems: { t1: [{ vault_id: "t1" }] },
    teamVaultIds: new Set(["t1"]),
    resolveVaultId: (id) => (id === "personal" ? "t1" : id),
  });
  expect(items).toEqual([{ vault_id: "t1" }]);
});

test("an unlinked personal vault offers local items without a vault id", () => {
  const items = selectVaultScopedItems({
    vaultId: "personal",
    localItems: [{}, { vault_id: "personal" }, { vault_id: "v2" }],
    teamItems: {},
    teamVaultIds: new Set(),
  });
  expect(items).toEqual([{}, { vault_id: "personal" }]);
});
