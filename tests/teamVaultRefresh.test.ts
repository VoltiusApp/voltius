import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldShowBlockingTeamVaultLoad,
  TeamVaultRefreshQueue,
} from "../src/services/teamVaultRefresh.ts";

test("background team vault refresh does not show blocking loading state", () => {
  assert.equal(shouldShowBlockingTeamVaultLoad({ background: true }), false);
  assert.equal(shouldShowBlockingTeamVaultLoad({ background: false }), true);
});

test("team vault refresh queue coalesces overlapping refreshes per team", async () => {
  const queue = new TeamVaultRefreshQueue();
  let runs = 0;
  let release: (() => void) | null = null;

  const first = queue.run("team-a", async () => {
    runs += 1;
    await new Promise<void>((resolve) => { release = resolve; });
  });
  const second = queue.run("team-a", async () => {
    runs += 1;
  });

  assert.equal(first, second);
  assert.equal(runs, 1);
  release?.();
  await Promise.all([first, second]);

  await queue.run("team-a", async () => {
    runs += 1;
  });
  assert.equal(runs, 2);
});
