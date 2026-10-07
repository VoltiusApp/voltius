import { test, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ onPick: () => {} }));

vi.mock("@/lib/invoke", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "download_dir_pick") h.onPick();
    return null;
  }),
}));
vi.mock("@/services/account", () => ({ getAccountMode: vi.fn(), lockVaultSession: vi.fn() }));
vi.mock("@/stores/appLockStore", () => ({ useAppLockStore: { getState: vi.fn() } }));

import { isLeaveLockSuppressed } from "./appLock";
import { downloadDirPick } from "./downloads";

test("opening the system folder picker does not count as leaving the app", async () => {
  let suppressed: boolean | null = null;
  h.onPick = () => { suppressed = isLeaveLockSuppressed(); };
  await downloadDirPick();
  expect(suppressed).toBe(true);
});
