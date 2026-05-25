import test from "node:test";
import assert from "node:assert/strict";
import { selectVaultScopedItems } from "../src/utils/vaultScopedItems.ts";

type Item = { id: string; vault_id?: string };

const localItems: Item[] = [
  { id: "personal-missing" },
  { id: "personal-explicit", vault_id: "personal" },
  { id: "local-1", vault_id: "local-vault-1" },
  { id: "local-2", vault_id: "local-vault-2" },
];

const teamItems: Record<string, Item[]> = {
  "team-1": [{ id: "team-1-item", vault_id: "team-1" }],
};

test("selects local vault items from the local store instead of team maps", () => {
  assert.deepEqual(
    selectVaultScopedItems({
      vaultId: "local-vault-1",
      localItems,
      teamItems,
      teamVaultIds: new Set(["team-1"]),
    }).map((item) => item.id),
    ["local-1"],
  );
});

test("selects team vault items from the team map", () => {
  assert.deepEqual(
    selectVaultScopedItems({
      vaultId: "team-1",
      localItems,
      teamItems,
      teamVaultIds: new Set(["team-1"]),
    }).map((item) => item.id),
    ["team-1-item"],
  );
});

test("selects only personal items for the personal vault", () => {
  assert.deepEqual(
    selectVaultScopedItems({
      vaultId: "personal",
      localItems,
      teamItems,
      teamVaultIds: new Set(["team-1"]),
    }).map((item) => item.id),
    ["personal-missing", "personal-explicit"],
  );
});
