import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDebouncedSaver } from "./EditorTab";

describe("createDebouncedSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces rapid edits into one save with the latest content", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const s = createDebouncedSaver(save, 1000);
    s.schedule("a");
    s.schedule("ab");
    s.schedule("abc");
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("abc");
  });

  it("cancel prevents a pending save", () => {
    const save = vi.fn();
    const s = createDebouncedSaver(save, 1000);
    s.schedule("x");
    s.cancel();
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();
  });
});
