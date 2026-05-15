import test from "node:test";
import assert from "node:assert/strict";
import { classifyTeamObjectListError } from "../src/services/teamVaultLoadErrors.ts";

test("team object list 500 falls back to legacy blob loading", () => {
  assert.equal(classifyTeamObjectListError(new Error("Failed to list team objects: 500")), "fallback");
});

test("team object list authorization errors map to user-facing states", () => {
  assert.equal(classifyTeamObjectListError(new Error("permission denied 403")), "forbidden");
  assert.equal(classifyTeamObjectListError(new Error("requires active subscription 402")), "payment_required");
});
