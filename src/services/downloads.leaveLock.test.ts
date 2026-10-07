import { test, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ onPick: () => {} }));

vi.mock("@/lib/invoke", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "download_dir_pick") h.onPick();
    return null;
  }),
}));

import { isLeaveLockSuppressed } from "./leaveLockSuppression";
import { downloadDirPick } from "./downloads";

test("opening the system folder picker does not count as leaving the app", async () => {
  let suppressed: boolean | null = null;
  h.onPick = () => { suppressed = isLeaveLockSuppressed(); };
  await downloadDirPick();
  expect(suppressed).toBe(true);
});
