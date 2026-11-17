import { describe, expect, it, vi } from "vitest";
import { singleFlight } from "./singleFlight";

describe("singleFlight", () => {
  it("concurrent calls share one run", async () => {
    let finish = () => {};
    const fn = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const { run } = singleFlight(fn);

    const first = run();
    const second = run();

    expect(second).toBe(first);
    expect(fn).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });

  it("next call after settle runs again", async () => {
    const fn = vi.fn(async () => {});
    const { run } = singleFlight(fn);

    await run();
    await run();

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("a rejected run frees the slot", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);
    const { run } = singleFlight(fn);

    await expect(run()).rejects.toThrow("boom");
    await expect(run()).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("calls during a run coalesce into exactly one rerun when asked", async () => {
    const finishers: Array<() => void> = [];
    const fn = vi.fn(() => new Promise<void>((r) => finishers.push(r)));
    const { run } = singleFlight(fn, { rerunIfCalledDuring: true });

    const first = run();
    const second = run();
    void run();
    expect(second).toBe(first);
    expect(fn).toHaveBeenCalledTimes(1);

    finishers[0]();
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    finishers[1]();
    await first;
    expect(fn).toHaveBeenCalledTimes(2);

    await run();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("without the option a call during a run does not rerun", async () => {
    let finish = () => {};
    const fn = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const { run } = singleFlight(fn);

    const first = run();
    void run();
    finish();
    await first;

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("idle waits for the in-flight run and resolves when none is running", async () => {
    let finish = () => {};
    const { run, idle } = singleFlight(() => new Promise<void>((r) => (finish = r)));
    await expect(idle()).resolves.toBeUndefined();

    const running = run();
    let settled = false;
    const waiting = idle().then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await Promise.all([running, waiting]);
    expect(settled).toBe(true);
  });
});
