import { test, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useCrossVaultPasteConfirm } from "./useCrossVaultPasteConfirm";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";

afterEach(() => cleanup());

beforeEach(() => useVaultClipboardStore.getState().clear());

function cut() {
  useVaultClipboardStore.getState().setClipboard({
    tab: "hosts",
    mode: "cut",
    items: [{ id: "c1", kind: "connection" }],
    folderIds: [],
    sourceVaultIds: ["personal"],
  });
}

test("accepting resolves the pending promise with true", async () => {
  cut();
  const { result } = renderHook(() => useCrossVaultPasteConfirm());
  let answer: Promise<boolean>;
  act(() => {
    answer = result.current.confirmCrossVault({ count: 2, targetVaultName: "Team One" });
  });
  expect(result.current.pending?.operation).toBe("move");
  expect(result.current.pending?.targetVaultName).toBe("Team One");
  act(() => result.current.accept());
  await expect(answer!).resolves.toBe(true);
  expect(result.current.pending).toBeNull();
});

test("cancelling resolves with false instead of stranding the paste", async () => {
  cut();
  const { result } = renderHook(() => useCrossVaultPasteConfirm());
  let answer: Promise<boolean>;
  act(() => {
    answer = result.current.confirmCrossVault({ count: 1, targetVaultName: "Team One" });
  });
  act(() => result.current.cancel());
  await expect(answer!).resolves.toBe(false);
  expect(result.current.pending).toBeNull();
});

// Navigating away destroys the modal, so an unanswered prompt has to be declined
// on unmount or the shared paste queue never advances again.
test("unmounting declines a still-pending confirmation instead of stranding it", async () => {
  cut();
  const { result, unmount } = renderHook(() => useCrossVaultPasteConfirm());
  let answer: Promise<boolean>;
  act(() => {
    answer = result.current.confirmCrossVault({ count: 1, targetVaultName: "Team One" });
  });
  unmount();
  await expect(answer!).resolves.toBe(false);
});

test("a copy is presented as a copy, not a move", () => {
  useVaultClipboardStore.getState().setClipboard({
    tab: "hosts",
    mode: "copy",
    items: [{ id: "c1", kind: "connection" }],
    folderIds: [],
    sourceVaultIds: ["personal"],
  });
  const { result } = renderHook(() => useCrossVaultPasteConfirm());
  act(() => {
    void result.current.confirmCrossVault({ count: 1, targetVaultName: "Team One" });
  });
  expect(result.current.pending?.operation).toBe("copy");
});
