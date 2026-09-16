import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { NOTES_SAVE_DELAY_MS, useNotesDraft } from "./useNotesDraft";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function setup(initial: string | undefined, save = vi.fn(async (_n: string | undefined) => {})) {
  const hook = renderHook(({ stored }) => useNotesDraft(stored, save), { initialProps: { stored: initial } });
  return { ...hook, save };
}

async function advance(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms); await Promise.resolve(); });
}

describe("useNotesDraft", () => {
  test("debounces edits into one save", async () => {
    const { result, save } = setup("a");
    act(() => result.current.setDraft("ab"));
    await advance(1000);
    act(() => result.current.setDraft("abc"));
    await advance(NOTES_SAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await advance(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("abc");
  });

  test("does not save a draft that returns to the stored value", async () => {
    const { result, save } = setup("a");
    act(() => result.current.setDraft("ab"));
    act(() => result.current.setDraft("a"));
    await advance(NOTES_SAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });

  test("saves blank as undefined", async () => {
    const { result, save } = setup("a");
    act(() => result.current.setDraft("  "));
    await advance(NOTES_SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledWith(undefined);
  });

  test("flushes a pending edit on unmount", async () => {
    const { result, save, unmount } = setup("a");
    act(() => result.current.setDraft("ab"));
    unmount();
    expect(save).toHaveBeenCalledWith("ab");
  });

  test("follows external changes while clean", () => {
    const { result, rerender } = setup("a");
    rerender({ stored: "remote" });
    expect(result.current.draft).toBe("remote");
    expect(result.current.conflict).toBe(false);
  });

  test("its own save echoing back is not a conflict, even if typing continued", async () => {
    let resolveSave!: () => void;
    const save = vi.fn(() => new Promise<void>((r) => { resolveSave = r; }));
    const { result, rerender } = setup("a", save);
    act(() => result.current.setDraft("ab"));
    await advance(NOTES_SAVE_DELAY_MS);
    act(() => result.current.setDraft("abc"));
    rerender({ stored: "ab" });
    await act(async () => { resolveSave(); await Promise.resolve(); });
    expect(result.current.conflict).toBe(false);
    expect(result.current.draft).toBe("abc");
  });

  test("an external change while dirty raises a conflict and blocks saving", async () => {
    const { result, rerender, save } = setup("a");
    act(() => result.current.setDraft("mine"));
    rerender({ stored: "theirs" });
    expect(result.current.conflict).toBe(true);
    await advance(NOTES_SAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });

  test("reload discards the draft", () => {
    const { result, rerender } = setup("a");
    act(() => result.current.setDraft("mine"));
    rerender({ stored: "theirs" });
    act(() => result.current.reload());
    expect(result.current).toMatchObject({ draft: "theirs", conflict: false });
  });

  test("keep mine saves the draft over the external value", async () => {
    const { result, rerender, save } = setup("a");
    act(() => result.current.setDraft("mine"));
    rerender({ stored: "theirs" });
    act(() => result.current.keepMine());
    await advance(NOTES_SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledWith("mine");
    expect(result.current.conflict).toBe(false);
  });

  test("a failed save keeps the draft, reports the error, and retry saves again", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const { result } = setup("a", save);
    act(() => result.current.setDraft("ab"));
    await advance(NOTES_SAVE_DELAY_MS);
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toMatchObject({ draft: "ab", error: "offline" });
    await act(async () => { result.current.retry(); await Promise.resolve(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });
});
