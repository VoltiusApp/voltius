import { test, expect, vi } from "vitest";
import { folderDragHandlers } from "@/utils/folderDragHandlers";

test("a drop onto a folder and an eject are the same item move", async () => {
  const moveItems = vi.fn(async () => {});
  const h = folderDragHandlers({ moveItems, moveFolders: vi.fn(async () => {}) });

  await h.onDropToFolder(["a"], "f1");
  await h.onEject(["a"], null);
  expect(moveItems.mock.calls).toEqual([[["a"], "f1"], [["a"], null]]);
});

test("a folder drop and a folder eject are the same folder move", async () => {
  const moveFolders = vi.fn(async () => {});
  const h = folderDragHandlers({ moveItems: vi.fn(async () => {}), moveFolders });

  await h.onMoveFolders(["f2"], "f1");
  await h.onEjectFolders(["f2"], null);
  expect(moveFolders.mock.calls).toEqual([[["f2"], "f1"], [["f2"], null]]);
});

test("a failure reaches onError instead of rejecting", async () => {
  const onError = vi.fn();
  const h = folderDragHandlers({
    moveItems: async () => { throw new Error("nope"); },
    moveFolders: vi.fn(async () => {}),
    onError,
  });

  await expect(h.onDropToFolder(["a"], "f1")).resolves.toBeUndefined();
  expect(onError).toHaveBeenCalledWith("Error: nope");
});

test("without onError the failure propagates", async () => {
  const h = folderDragHandlers({
    moveItems: async () => { throw new Error("nope"); },
    moveFolders: vi.fn(async () => {}),
  });

  await expect(h.onDropToFolder(["a"], "f1")).rejects.toThrow("nope");
});
