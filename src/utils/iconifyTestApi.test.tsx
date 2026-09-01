import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { Icon } from "@iconify/react";

// Guards vitest.setup.ts. Without the inert API module, Iconify batches the icon on a
// 0ms tick and only then arms its query retry/timeout timers (750ms, 499ms, 4000ms).
// The 4s one outlives short test files and fires into a torn-down jsdom, failing the
// run with zero test failures — so this has to look *after* the batching tick.
describe("iconify in tests", () => {
  test("rendering an icon arms no timer that can outlive the test file", async () => {
    const realTimeout = globalThis.setTimeout;
    const wait = (ms: number) =>
      new Promise((resolve) => (realTimeout as unknown as (...a: unknown[]) => number)(resolve, ms));
    const delays: number[] = [];
    (globalThis as unknown as { setTimeout: unknown }).setTimeout = (
      fn: () => void,
      ms?: number,
      ...rest: unknown[]
    ) => {
      delays.push(ms ?? 0);
      return (realTimeout as unknown as (...a: unknown[]) => number)(fn, ms, ...rest);
    };

    try {
      render(<Icon icon="lucide:chevron-down" width={12} />);
      await wait(50);
    } finally {
      (globalThis as unknown as { setTimeout: unknown }).setTimeout = realTimeout;
    }

    expect(delays.filter((ms) => ms > 0)).toEqual([]);
  });
});
