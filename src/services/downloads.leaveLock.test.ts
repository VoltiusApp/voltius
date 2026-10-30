// @vitest-environment jsdom
import { test, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ onPick: () => {} }));

vi.mock("@/lib/invoke", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "download_dir_pick" || cmd === "upload_pick") h.onPick();
    return cmd === "upload_pick" ? [] : null;
  }),
}));

import { isLeaveLockSuppressed } from "./leaveLockSuppression";
import { downloadDirPick } from "./downloads";
import { uploadPick } from "./uploads";

test.each([
  ["folder picker", downloadDirPick],
  ["upload file picker", uploadPick],
])("opening the system %s does not count as leaving the app", async (_name, pick) => {
  let suppressed: boolean | null = null;
  h.onPick = () => { suppressed = isLeaveLockSuppressed(); };
  await pick();
  expect(suppressed).toBe(true);
});
