import test from "node:test";
import assert from "node:assert/strict";
import { deriveAccessibleVaultIds } from "../src/hooks/accessibleVaults.ts";

test("keeps persisted selected team accessible before cloud connection activates", () => {
  assert.deepEqual(
    deriveAccessibleVaultIds({
      selectedVaultIds: ["team-a"],
      vaults: [],
      teams: [{ id: "team-a", name: "Team A", owner_id: "owner", role_ids: [], created_at: "now" }],
      cloudActive: false,
    }),
    ["team-a"],
  );
});

test("excludes unknown raw team ids before cloud team list knows about them", () => {
  assert.deepEqual(
    deriveAccessibleVaultIds({
      selectedVaultIds: ["stale-team"],
      vaults: [],
      teams: [],
      cloudActive: false,
    }),
    [],
  );
});
