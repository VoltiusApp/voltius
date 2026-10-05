// @vitest-environment jsdom
import { test, expect } from "vitest";
import { deriveAccessibleVaultIds } from "../src/hooks/accessibleVaults.ts";

test("keeps persisted selected team accessible before cloud connection activates", () => {
  expect(deriveAccessibleVaultIds({
      selectedVaultIds: ["team-a"],
      vaults: [],
      teams: [{ id: "team-a", name: "Team A", owner_id: "owner", role_ids: [], created_at: "now" }],
      cloudActive: false,
    })).toEqual(["team-a"]);
});

test("excludes unknown raw team ids before cloud team list knows about them", () => {
  expect(deriveAccessibleVaultIds({
      selectedVaultIds: ["stale-team"],
      vaults: [],
      teams: [],
      cloudActive: false,
    })).toEqual([]);
});
