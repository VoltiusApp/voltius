import { test, expect, beforeEach } from "vitest";
import { useVaultClipboardStore } from "./vaultClipboardStore";

beforeEach(() => useVaultClipboardStore.getState().clear());

test("starts empty", () => {
  expect(useVaultClipboardStore.getState().clipboard).toBeNull();
});

test("holds a cut payload and clears it", () => {
  useVaultClipboardStore.getState().setClipboard({
    tab: "hosts",
    mode: "cut",
    items: [{ id: "c1", kind: "connection" }],
    folderIds: ["f1"],
    sourceVaultIds: ["personal"],
  });
  const c = useVaultClipboardStore.getState().clipboard;
  expect(c?.mode).toBe("cut");
  expect(c?.items).toEqual([{ id: "c1", kind: "connection" }]);
  expect(c?.folderIds).toEqual(["f1"]);

  useVaultClipboardStore.getState().clear();
  expect(useVaultClipboardStore.getState().clipboard).toBeNull();
});

test("replacing the clipboard discards the previous payload", () => {
  const s = useVaultClipboardStore.getState();
  s.setClipboard({ tab: "hosts", mode: "cut", items: [{ id: "a", kind: "connection" }], folderIds: [], sourceVaultIds: [] });
  s.setClipboard({ tab: "snippets", mode: "copy", items: [{ id: "b", kind: "snippet" }], folderIds: [], sourceVaultIds: [] });
  const c = useVaultClipboardStore.getState().clipboard;
  expect(c?.tab).toBe("snippets");
  expect(c?.mode).toBe("copy");
  expect(c?.items).toEqual([{ id: "b", kind: "snippet" }]);
});
