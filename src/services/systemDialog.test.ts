// @vitest-environment jsdom
import { test, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ seen: [] as boolean[] }));

vi.mock("@tauri-apps/plugin-dialog", async () => {
  const { isLeaveLockSuppressed } = await vi.importActual<typeof import("./leaveLockSuppression")>("./leaveLockSuppression");
  return {
    open: vi.fn(async () => { h.seen.push(isLeaveLockSuppressed()); return null; }),
    save: vi.fn(async () => { h.seen.push(isLeaveLockSuppressed()); return null; }),
  };
});

import { isLeaveLockSuppressed } from "./leaveLockSuppression";
import { openSystemDialog, pickWithFileInput, saveSystemDialog } from "./systemDialog";

test("the open and save pickers do not count as leaving the app", async () => {
  await openSystemDialog({ directory: true });
  await saveSystemDialog({ defaultPath: "x.txt" });
  expect(h.seen).toEqual([true, true]);
  expect(isLeaveLockSuppressed()).toBe(false);
});

test("a file input's picker does not count as leaving until it reports back", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.click = vi.fn();
  pickWithFileInput(input);
  expect(input.click).toHaveBeenCalled();
  expect(isLeaveLockSuppressed()).toBe(true);
  input.dispatchEvent(new Event("cancel"));
  return new Promise<void>((r) => setTimeout(() => {
    expect(isLeaveLockSuppressed()).toBe(false);
    r();
  }, 0));
});
