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
