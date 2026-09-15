import { test, expect } from "vitest";
import { isManualSyncRunning, runManualSync } from "./syncIntent";

test("a manual sync is flagged only while it runs, even when it fails", async () => {
  let seen = false;
  await runManualSync(async () => { seen = isManualSyncRunning(); });
  expect(seen).toBe(true);
  expect(isManualSyncRunning()).toBe(false);

  await expect(runManualSync(() => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
  expect(isManualSyncRunning()).toBe(false);
});
