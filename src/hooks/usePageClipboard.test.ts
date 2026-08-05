import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { usePageClipboard } from "./usePageClipboard";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";
import { useUIStore } from "@/stores/uiStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useHistoryStore } from "@/stores/historyStore";

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
  useNotificationStore.setState({ toasts: [] });
  useHistoryStore.setState({
    past: [], future: [], bypassing: false, suppressing: false, suppressDepth: 0,
    canUndo: false, canRedo: false,
  });
});

// Each page owns a paste queue only if the queue is per hook; a paste started on
// another page while one is in flight then runs inside the first paste's
// `withoutHistory` window and has its composite entry swallowed by it.
test("a paste on another page does not lose its history entry to an in-flight one", async () => {
  let releaseHosts!: (ids: string[]) => void;
  const hosts = baseAdapter({
    duplicateItems: vi.fn(() => new Promise<string[]>((r) => { releaseHosts = r; })),
  });
  const keychain = baseAdapter({ navItem: "keychain", moveItems: vi.fn(async () => {}) });
  renderHook(() => usePageClipboard(hosts));
  renderHook(() => usePageClipboard(keychain));

  window.dispatchEvent(new CustomEvent("voltius:clipboard-copy"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  await vi.waitFor(() => expect(hosts.duplicateItems).toHaveBeenCalledTimes(1));

  useUIStore.setState({ activeNav: "keychain" });
  window.dispatchEvent(new CustomEvent("voltius:clipboard-cut"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));

  releaseHosts(["c1-copy"]);
  await vi.waitFor(() => expect(keychain.moveItems).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(useHistoryStore.getState().past).toHaveLength(2));
  expect(useHistoryStore.getState().suppressing).toBe(false);
  expect(useHistoryStore.getState().canUndo).toBe(true);
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

test("a cross-vault paste asks for confirmation and aborts when declined", async () => {
  const confirmCrossVault = vi.fn(async () => false);
  const a = baseAdapter({ targetVaultId: () => "team-1", confirmCrossVault });
  renderHook(() => usePageClipboard(a));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-cut"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  await vi.waitFor(() => expect(confirmCrossVault).toHaveBeenCalled());
  expect(confirmCrossVault).toHaveBeenCalledWith({ count: 1, targetVaultName: "team-1" });
  expect(a.moveItems).not.toHaveBeenCalled();
  expect(useVaultClipboardStore.getState().clipboard).not.toBeNull();
});

test("a cross-vault paste proceeds when confirmed", async () => {
  const confirmCrossVault = vi.fn(async () => true);
  const a = baseAdapter({
    targetVaultId: () => "team-1",
    targetVaultName: () => "Team One",
    confirmCrossVault,
  });
  renderHook(() => usePageClipboard(a));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-cut"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  await vi.waitFor(() => expect(a.moveItems).toHaveBeenCalled());
  expect(confirmCrossVault).toHaveBeenCalledWith({ count: 1, targetVaultName: "Team One" });
});

test("a same-vault paste does not ask for confirmation", async () => {
  const confirmCrossVault = vi.fn(async () => true);
  const a = baseAdapter({ confirmCrossVault });
  renderHook(() => usePageClipboard(a));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-cut"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  await vi.waitFor(() => expect(a.moveItems).toHaveBeenCalled());
  expect(confirmCrossVault).not.toHaveBeenCalled();
});

test("a blocked paste raises a toast and mutates nothing", async () => {
  const a = baseAdapter({ targetVaultId: () => "team-1", can: () => false });
  renderHook(() => usePageClipboard(a));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-cut"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  await vi.waitFor(() => expect(useNotificationStore.getState().toasts).toHaveLength(1));
  const toast = useNotificationStore.getState().toasts[0];
  expect(toast.severity).toBe("warning");
  expect(toast.message).toContain("Edit connections");
  expect(a.moveItems).not.toHaveBeenCalled();
  expect(useVaultClipboardStore.getState().clipboard).not.toBeNull();
});

// pasteChain is shared by every page, so a confirmation left unanswered by an
// unmounting page would silently kill Ctrl+V on all four tabs for the process.
test("unmounting mid-confirmation leaves the shared paste chain usable", async () => {
  const confirmCrossVault = vi.fn(() => new Promise<boolean>(() => {}));
  const stalled = baseAdapter({ targetVaultId: () => "team-1", confirmCrossVault });
  const { unmount } = renderHook(() => usePageClipboard(stalled));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-cut"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  await vi.waitFor(() => expect(confirmCrossVault).toHaveBeenCalled());

  unmount();

  const fresh = baseAdapter();
  renderHook(() => usePageClipboard(fresh));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-copy"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  await vi.waitFor(() => expect(fresh.duplicateItems).toHaveBeenCalledTimes(1));
  expect(stalled.moveItems).not.toHaveBeenCalled();
});

test("objects that vanished between cut and paste are reported", async () => {
  const a = baseAdapter({ exists: () => false });
  renderHook(() => usePageClipboard(a));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-cut"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  await vi.waitFor(() => expect(useNotificationStore.getState().toasts).toHaveLength(1));
  expect(useNotificationStore.getState().toasts[0].message).toContain("no longer exists");
  expect(a.moveItems).not.toHaveBeenCalled();
});

// A rejected paste used to reach console.error only: Ctrl+V looked like a no-op.
test("a paste that rejects raises an error toast", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const a = baseAdapter({
    targetVaultId: () => "personal",
    moveItems: vi.fn(async () => { throw new Error("Connection c1 not found"); }),
  });
  renderHook(() => usePageClipboard(a));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-cut"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  await vi.waitFor(() => expect(useNotificationStore.getState().toasts).toHaveLength(1));
  const toast = useNotificationStore.getState().toasts[0];
  expect(toast.severity).toBe("error");
  expect(toast.message).toContain("Connection c1 not found");
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});

// Ctrl+V at a root cannot migrate vaults by design, so the object is dropped —
// which was indistinguishable from a dead shortcut until it was said out loud.
test("a root paste that cannot change vault raises a toast", async () => {
  const a = baseAdapter({
    targetFolderId: () => null,
    targetVaultId: () => null,
    folderIdOf: () => null,
    vaultIdOf: () => "team-1",
    rootVaultIds: () => ["personal"],
  });
  renderHook(() => usePageClipboard(a));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-cut"));
  window.dispatchEvent(new CustomEvent("voltius:clipboard-paste"));
  await vi.waitFor(() => expect(useNotificationStore.getState().toasts).toHaveLength(1));
  expect(useNotificationStore.getState().toasts[0].message).toContain("top level");
  expect(a.moveItems).not.toHaveBeenCalled();
});
