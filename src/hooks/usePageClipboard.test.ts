import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { usePageClipboard } from "./usePageClipboard";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";
import { useUIStore } from "@/stores/uiStore";

function baseAdapter(over = {}) {
  return {
    navItem: "hosts" as const,
    getSelection: () => ["c1"],
    getFocusedId: () => null,
    classify: (id: string) => (id === "f1" ? ("folder" as const) : ("connection" as const)),
    exists: () => true,
    vaultIdOf: () => "personal",
    targetFolderId: () => null,
    targetVaultId: () => "personal",
    folderIdOf: () => "old",
    folderContentKinds: () => [],
    canMoveFolder: () => true,
    can: () => true,
    moveItems: vi.fn(async () => {}),
    moveFolder: vi.fn(async () => {}),
    duplicateItems: vi.fn(async (ids: string[]) => ids.map((i) => `${i}-copy`)),
    duplicateFolder: vi.fn(async (id: string) => `${id}-copy`),
    deleteItems: vi.fn(async () => {}),
    deleteFolder: vi.fn(async () => {}),
    setSelection: vi.fn(),
    ...over,
  };
}

// vitest.config.ts sets no `globals: true`, so testing-library's automatic
// cleanup never registers. Without this, each renderHook leaks a live window
// listener into the next test.
afterEach(() => cleanup());

beforeEach(() => {
  useVaultClipboardStore.getState().clear();
  useUIStore.setState({ activeNav: "hosts" });
});

test("cut fills the clipboard from the selection", () => {
  renderHook(() => usePageClipboard(baseAdapter()));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-cut"));
  const c = useVaultClipboardStore.getState().clipboard;
  expect(c?.mode).toBe("cut");
  expect(c?.items).toEqual([{ id: "c1", kind: "connection" }]);
});

test("copy falls back to the focused card when nothing is selected", () => {
  renderHook(() => usePageClipboard(baseAdapter({ getSelection: () => [], getFocusedId: () => "c9" })));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-copy"));
  expect(useVaultClipboardStore.getState().clipboard?.items).toEqual([{ id: "c9", kind: "connection" }]);
});

test("copy with no selection and no focus does nothing", () => {
  renderHook(() => usePageClipboard(baseAdapter({ getSelection: () => [], getFocusedId: () => null })));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-copy"));
  expect(useVaultClipboardStore.getState().clipboard).toBeNull();
});

test("folders are captured separately from items", () => {
  renderHook(() => usePageClipboard(baseAdapter({ getSelection: () => ["c1", "f1"] })));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-cut"));
  const c = useVaultClipboardStore.getState().clipboard;
  expect(c?.items).toEqual([{ id: "c1", kind: "connection" }]);
  expect(c?.folderIds).toEqual(["f1"]);
});

test("events are ignored when the page is not the active tab", () => {
  useUIStore.setState({ activeNav: "snippets" });
  renderHook(() => usePageClipboard(baseAdapter()));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-cut"));
  expect(useVaultClipboardStore.getState().clipboard).toBeNull();
});

test("a cut paste consumes the clipboard", async () => {
  const a = baseAdapter();
  renderHook(() => usePageClipboard(a));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-cut"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  await vi.waitFor(() => expect(useVaultClipboardStore.getState().clipboard).toBeNull());
});

test("a copy paste retains the clipboard so a second paste duplicates again", async () => {
  const a = baseAdapter();
  renderHook(() => usePageClipboard(a));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-copy"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  await vi.waitFor(() => expect(a.duplicateItems).toHaveBeenCalledTimes(1));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  await vi.waitFor(() => expect(a.duplicateItems).toHaveBeenCalledTimes(2));
  expect(useVaultClipboardStore.getState().clipboard).not.toBeNull();
});

test("two back-to-back copy pastes are serialized and still both duplicate", async () => {
  const resolvers: Array<() => void> = [];
  const duplicateItems = vi.fn(
    (ids: string[]) =>
      new Promise<string[]>((resolve) => {
        resolvers.push(() => resolve(ids.map((i) => `${i}-copy`)));
      }),
  );
  const a = baseAdapter({ duplicateItems });
  renderHook(() => usePageClipboard(a));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-copy"));

  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));

  // The second paste must not start its own duplicateItems call until the
  // first one, still in flight, resolves.
  await vi.waitFor(() => expect(duplicateItems).toHaveBeenCalledTimes(1));
  expect(duplicateItems).toHaveBeenCalledTimes(1);

  resolvers[0]();
  await vi.waitFor(() => expect(duplicateItems).toHaveBeenCalledTimes(2));

  resolvers[1]();
  await vi.waitFor(() => expect(useVaultClipboardStore.getState().clipboard).not.toBeNull());
  expect(duplicateItems).toHaveBeenCalledTimes(2);
});

test("two back-to-back cut pastes serialize into a single move", async () => {
  let resolveMove: (() => void) | undefined;
  const moveItems = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveMove = resolve;
      }),
  );
  const a = baseAdapter({ moveItems });
  renderHook(() => usePageClipboard(a));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-cut"));

  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));

  await vi.waitFor(() => expect(moveItems).toHaveBeenCalledTimes(1));
  resolveMove?.();

  await vi.waitFor(() => expect(useVaultClipboardStore.getState().clipboard).toBeNull());
  // The queued second paste now runs against an already-cleared clipboard
  // and is a no-op — it must not issue a second move.
  expect(moveItems).toHaveBeenCalledTimes(1);
});

test("a rejected paste does not stall subsequent pastes", async () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const moveItems = vi.fn(async () => {
    throw new Error("network down");
  });
  const a = baseAdapter({ moveItems });
  renderHook(() => usePageClipboard(a));

  window.dispatchEvent(new CustomEvent("voltius:clipboard-cut"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  await vi.waitFor(() => expect(moveItems).toHaveBeenCalledTimes(1));
  // Let the rejection settle before queuing the next, healthy paste.
  await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());

  window.dispatchEvent(new CustomEvent("voltius:clipboard-copy"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  await vi.waitFor(() => expect(a.duplicateItems).toHaveBeenCalledTimes(1));

  errorSpy.mockRestore();
});
