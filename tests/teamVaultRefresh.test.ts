import { test, expect } from "vitest";
import {
  shouldShowBlockingTeamVaultLoad,
  TeamVaultRefreshQueue,
} from "../src/services/teamVaultRefresh.ts";

test("background team vault refresh does not show blocking loading state", () => {
  expect(shouldShowBlockingTeamVaultLoad({ background: true })).toBe(false);
  expect(shouldShowBlockingTeamVaultLoad({ background: false })).toBe(true);
});

test("team vault refresh queue coalesces overlapping refreshes per team", async () => {
  const queue = new TeamVaultRefreshQueue();
  const releases: (() => void)[] = [];
  let runs = 0;
  const refresh = () => new Promise<void>((resolve) => {
    runs += 1;
    releases.push(resolve);
  });

  const first = queue.run("team-a", {}, refresh);
  const second = queue.run("team-a", {}, refresh);
  const third = queue.run("team-a", {}, refresh);
  expect(second).toBe(third);
  expect(runs).toBe(1);

  releases.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(runs).toBe(2);
  releases.shift()?.();
  await Promise.all([first, second, third]);
  expect(runs).toBe(2);

  let runsB = 0;
  await queue.run("team-b", {}, () => { runsB += 1; return Promise.resolve(); });
  expect(runsB).toBe(1);
});
