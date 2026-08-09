import { describe, it, expect, vi } from "vitest";
import { firstSnapshot } from "./streamOneShot";

const ports = (emit: boolean) => {
  const unsubscribe = vi.fn();
  return {
    start: vi.fn(async () => "st1"),
    stop: vi.fn(async () => undefined),
    onSnapshot: vi.fn(async (_id: string, cb: (s: unknown) => void) => {
      if (emit) setTimeout(() => cb({ cpu: 12 }), 0);
      return unsubscribe;
    }),
    unsubscribe,
  };
};

describe("firstSnapshot", () => {
  it("resolves with the first snapshot and stops the stream", async () => {
    const p = ports(true);
    await expect(firstSnapshot(p, "s1", true, 1000)).resolves.toEqual({ cpu: 12 });
    expect(p.stop).toHaveBeenCalledWith("st1");
    expect(p.unsubscribe).toHaveBeenCalled();
  });

  it("stops the stream and unsubscribes when no snapshot ever arrives", async () => {
    vi.useFakeTimers();
    const p = ports(false);
    const pending = firstSnapshot(p, "s1", true, 1000);
    pending.catch(() => {});
    await vi.advanceTimersByTimeAsync(1100);
    await expect(pending).rejects.toThrow(/no snapshot/i);
    expect(p.stop).toHaveBeenCalledWith("st1");
    expect(p.unsubscribe).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("still stops the stream when onSnapshot itself rejects", async () => {
    const p = {
      start: vi.fn(async () => "st1"),
      stop: vi.fn(async () => undefined),
      onSnapshot: vi.fn(async () => {
        throw new Error("listen failed");
      }),
    };
    await expect(firstSnapshot(p, "s1", true, 1000)).rejects.toThrow(/listen failed/);
    expect(p.stop).toHaveBeenCalledWith("st1");
  });
});
