import { test, expect, vi } from "vitest";
import { folderDragHandlers } from "./folderDragHandlers";
import { RuleSetMoveCancelled } from "@/services/teamObjectPersistence";

const cancelled = () => Promise.reject(new RuleSetMoveCancelled());

test("a cancelled move does not set the page error", async () => {
  const onError = vi.fn();
  const drag = folderDragHandlers({ moveItems: cancelled, moveFolders: cancelled, onError });

  await drag.onDropToFolder(["c1"], "f1");
  await drag.onEject(["c1"], null);
  await drag.onMoveFolders(["f2"], "f1");
  await drag.onEjectFolders(["f2"], null);

  expect(onError).not.toHaveBeenCalled();
});

test("a failed move still sets the page error", async () => {
  const onError = vi.fn();
  const drag = folderDragHandlers({ moveItems: () => Promise.reject(new Error("boom")), moveFolders: vi.fn(), onError });

  await drag.onDropToFolder(["c1"], "f1");

  expect(onError).toHaveBeenCalledWith("boom");
});

test("without an error handler a cancelled move settles quietly and a failure still rejects", async () => {
  const drag = folderDragHandlers({ moveItems: cancelled, moveFolders: () => Promise.reject(new Error("boom")) });

  await expect(drag.onDropToFolder(["c1"], "f1")).resolves.toBeUndefined();
  await expect(drag.onMoveFolders(["f2"], "f1")).rejects.toThrow("boom");
});
